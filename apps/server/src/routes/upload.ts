import { Hono, type MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { fromBase64url } from "@skysend/crypto";
import type { StorageBackend } from "../storage/types.js";
import type { QuotaVariables } from "../types.js";
import type { createUploadQuota, QuotaReservation } from "../middleware/quota.js";
import { uploadHeadersSchema, validateUploadHeaders, type UploadHeaders } from "../lib/upload-validation.js";
import { createChunkedUploads } from "../lib/chunked-upload.js";

/** What a chunked upload keeps until finalize: its headers and the bytes its init reserved. */
type UploadSession = UploadHeaders & { quotaReservation?: QuotaReservation };

/** Raised when a single-request body grows past the size its headers declared. */
class BodyTooLargeError extends Error {}

/**
 * Passes a body through until it grows past `max` bytes, then fails the stream, so a client
 * cannot fill the disk with a body that never ends while it declared a small one.
 */
function capped(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) controller.error(new BodyTooLargeError());
        else controller.enqueue(chunk);
      },
    }),
  );
}

export interface UploadRouteOptions {
  /**
   * Where chunk bodies wait until they are appended in order. Emptied when the
   * route is created, so it must belong to this server alone.
   */
  chunkDir: string;
  /** Overrides MAX_CHUNK_SIZE in tests. */
  maxChunkSize?: number;
  /** Who may start an upload, the OIDC guard when `OIDC_PROTECT_FILES` is on. */
  startGuard?: MiddlewareHandler;
  /** The upload quota, which reserves the bytes of an upload when it starts. */
  quota?: Pick<ReturnType<typeof createUploadQuota>, "middleware">;
}

export function createUploadRoute(
  storage: StorageBackend,
  { chunkDir, maxChunkSize, startGuard, quota }: UploadRouteOptions,
) {
  const route = new Hono<{ Variables: QuotaVariables }>();

  // An upload starts at the chunked init or the single-request upload, which stores a file in
  // one go. Both pass the guard and then the quota. Chunk and finalize requests need neither,
  // they belong to a session only a started upload has and run on its reservation.
  for (const start of ["/init", "/"]) {
    if (startGuard) route.use(start, startGuard);
    if (quota) route.use(start, quota.middleware);
  }

  // Sessions of chunked uploads, see lib/chunked-upload.ts for the limits they enforce.
  const chunked = createChunkedUploads<UploadSession>(storage, {
    chunkDir,
    maxChunkSize,
    onAbandon: (_id, meta) => meta.quotaReservation?.release(),
  });

  /**
   * POST /api/upload/init
   * Initialize a chunked upload session. Validates headers and creates
   * an empty file. Returns the upload ID for subsequent chunk uploads.
   */
  route.post("/init", async (c) => {
    const config = getConfig();

    const headerResult = uploadHeadersSchema.safeParse({
      authToken: c.req.header("X-Auth-Token"),
      ownerToken: c.req.header("X-Owner-Token"),
      salt: c.req.header("X-Salt"),
      maxDownloads: c.req.header("X-Max-Downloads"),
      expireSec: c.req.header("X-Expire-Sec"),
      fileCount: c.req.header("X-File-Count"),
      contentLength: c.req.header("X-Content-Length") ?? c.req.header("Content-Length"),
      hasPassword: c.req.header("X-Has-Password"),
      passwordSalt: c.req.header("X-Password-Salt") || undefined,
      passwordAlgo: c.req.header("X-Password-Algo") || undefined,
    });

    if (!headerResult.success) {
      return c.json(
        { error: "Invalid request headers", details: headerResult.error.flatten().fieldErrors },
        400,
      );
    }

    const headers = headerResult.data;

    // Validate salt, limits, password - same as single-request upload
    const validationError = validateUploadHeaders(headers, config);
    if (validationError) {
      return c.json({ error: validationError.message }, validationError.status);
    }

    const id = await chunked.open(headers.contentLength, {
      ...headers,
      quotaReservation: c.get("quotaReservation"),
    });
    return c.json({ id }, 201);
  });

  /**
   * POST /api/upload/:id/chunk?index=N
   * Append a chunk of encrypted data to a pending upload.
   */
  route.post("/:id/chunk", (c) => chunked.receiveChunk(c, c.req.param("id")));

  /**
   * POST /api/upload/:id/finalize
   * Finalize a chunked upload: verify total bytes match and create DB record.
   */
  route.post("/:id/finalize", async (c) => {
    const id = c.req.param("id");
    const session = await chunked.take(id);
    if (!session) {
      return c.json({ error: "Upload session not found or expired" }, 404);
    }

    const headers = session.meta;
    // Every way out below either stores the upload and commits its reservation, or gives the
    // reservation back in the finally block.
    try {
      // Verify total bytes
      if (session.bytesWritten !== headers.contentLength) {
        await storage.abortChunkedUpload(id).catch(() => {});
        return c.json(
          { error: "Body size does not match declared content length" },
          400,
        );
      }

      // Finalize the storage backend (completes S3 multipart upload, no-op for filesystem)
      try {
        await storage.finalizeChunkedUpload(id);
      } catch (err) {
        await storage.abortChunkedUpload(id).catch(() => {});
        throw err;
      }

      // Decode password salt if present
      let passwordSaltBuffer: Buffer | null = null;
      if (headers.hasPassword && headers.passwordSalt) {
        passwordSaltBuffer = Buffer.from(fromBase64url(headers.passwordSalt));
      }

      // Create database record
      const now = new Date();
      const expiresAt = new Date(now.getTime() + headers.expireSec * 1000);
      const storagePath = `${id}.bin`;

      const db = getDb();
      try {
        db.insert(uploads).values({
          id,
          ownerToken: headers.ownerToken,
          authToken: headers.authToken,
          salt: Buffer.from(fromBase64url(headers.salt)),
          size: session.bytesWritten,
          fileCount: headers.fileCount,
          hasPassword: headers.hasPassword,
          passwordSalt: passwordSaltBuffer,
          passwordAlgo: headers.hasPassword ? (headers.passwordAlgo ?? null) : null,
          maxDownloads: headers.maxDownloads,
          downloadCount: 0,
          expiresAt,
          createdAt: now,
          storagePath,
        }).run();
      } catch (err) {
        await storage.delete(id).catch(() => {});
        throw err;
      }

      headers.quotaReservation?.commit(session.bytesWritten);
      return c.json({ id }, 200);
    } finally {
      headers.quotaReservation?.release();
    }
  });

  /**
   * POST /api/upload
   * Single-request upload (legacy). Streams the entire encrypted file body
   * to disk in one request. Still used as a simple fallback.
   */
  route.post("/", async (c) => {
    const config = getConfig();

    // Parse and validate headers
    const headerResult = uploadHeadersSchema.safeParse({
      authToken: c.req.header("X-Auth-Token"),
      ownerToken: c.req.header("X-Owner-Token"),
      salt: c.req.header("X-Salt"),
      maxDownloads: c.req.header("X-Max-Downloads"),
      expireSec: c.req.header("X-Expire-Sec"),
      fileCount: c.req.header("X-File-Count"),
      contentLength: c.req.header("X-Content-Length") ?? c.req.header("Content-Length"),
      hasPassword: c.req.header("X-Has-Password"),
      passwordSalt: c.req.header("X-Password-Salt") || undefined,
      passwordAlgo: c.req.header("X-Password-Algo") || undefined,
    });

    if (!headerResult.success) {
      return c.json(
        { error: "Invalid request headers", details: headerResult.error.flatten().fieldErrors },
        400,
      );
    }

    const headers = headerResult.data;

    const validationError = validateUploadHeaders(headers, config);
    if (validationError) {
      return c.json({ error: validationError.message }, validationError.status);
    }

    // Ensure we have a request body
    const body = c.req.raw.body;
    if (!body) {
      return c.json({ error: "Missing request body" }, 400);
    }

    const id = randomUUID();
    const storagePath = `${id}.bin`;

    // Stream the encrypted body to disk, never more than it declared
    let bytesWritten: number;
    try {
      bytesWritten = await storage.save(id, capped(body, headers.contentLength));
    } catch (err) {
      // Clean up partial file on error
      await storage.delete(id).catch(() => {});
      if (err instanceof BodyTooLargeError) {
        return c.json({ error: "Body size does not match declared content length" }, 413);
      }
      throw err;
    }

    // Verify the actual bytes match declared content length
    if (bytesWritten !== headers.contentLength) {
      await storage.delete(id).catch(() => {});
      return c.json(
        { error: "Body size does not match declared content length" },
        400,
      );
    }

    // Decode password salt if present
    let passwordSaltBuffer: Buffer | null = null;
    if (headers.hasPassword && headers.passwordSalt) {
      passwordSaltBuffer = Buffer.from(fromBase64url(headers.passwordSalt));
    }

    // Create database record
    const now = new Date();
    const expiresAt = new Date(now.getTime() + headers.expireSec * 1000);

    const db = getDb();
    try {
      db.insert(uploads).values({
        id,
        ownerToken: headers.ownerToken,
        authToken: headers.authToken,
        salt: Buffer.from(fromBase64url(headers.salt)),
        size: bytesWritten,
        fileCount: headers.fileCount,
        hasPassword: headers.hasPassword,
        passwordSalt: passwordSaltBuffer,
        passwordAlgo: headers.hasPassword ? (headers.passwordAlgo ?? null) : null,
        maxDownloads: headers.maxDownloads,
        downloadCount: 0,
        expiresAt,
        createdAt: now,
        storagePath,
      }).run();
    } catch (err) {
      await storage.delete(id).catch(() => {});
      throw err;
    }

    // The quota middleware gives the reservation back if this upload fails.
    c.get("quotaReservation")?.commit(bytesWritten);

    return c.json({
      id,
      url: `${config.BASE_URL}/#${id}`,
    }, 201);
  });

  return route;
}
