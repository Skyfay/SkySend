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
import {
  createChunkedUploads,
  MIN_PROGRESS_BYTES,
  PROGRESS_CHECK_MS,
  PROGRESS_WINDOW_MS,
} from "../lib/chunked-upload.js";

/** What a chunked upload keeps until finalize: its headers and the bytes its init reserved. */
type UploadSession = UploadHeaders & { quotaReservation?: QuotaReservation };

/** Raised when a single-request body grows past the size its headers declared. */
class BodyTooLargeError extends Error {}

/** Raised when a single-request body stops making progress, see guardedBody. */
class BodyStalledError extends Error {}

/**
 * The body of a single-request upload as storage reads it. The stream fails when the body
 * grows past `max` bytes, so a client cannot fill the disk with a body that never ends while it
 * declared a small one. It also fails when the sender stalls: like a chunked or WebSocket
 * upload, the body has to bring MIN_PROGRESS_BYTES, or the rest of the upload, in every
 * PROGRESS_WINDOW_MS. Node has no timeout for a body, so a client that sent its headers and then
 * nothing held its reservation, the one in the storage limit included, for as long as it kept
 * the connection open. Only time in which storage waits for the sender counts, since time in
 * which storage holds the body back, like an S3 part waiting for memory, is no stall of the
 * sender. `stop` ends the check, the route calls it however the upload ends.
 */
function guardedBody(body: ReadableStream<Uint8Array>, max: number) {
  const reader = body.getReader();
  let seen = 0;
  let windowBytes = 0;
  /** Time storage waited for the sender in this window, not counting the wait running now. */
  let waited = 0;
  /** When the read storage waits on now started, 0 while storage waits for nothing. */
  let waitingSince = 0;
  let ended = false;
  let output!: ReadableStreamDefaultController<Uint8Array>;

  const stop = () => {
    ended = true;
    clearInterval(timer);
  };
  // Runs only while the check is on: from the timer, which stop() clears, and from pull() after
  // its check of `ended`.
  const fail = (err: Error) => {
    stop();
    output.error(err);
    reader.cancel(err).catch(() => {});
  };

  const timer = setInterval(() => {
    const now = Date.now();
    if (waited + (waitingSince ? now - waitingSince : 0) < PROGRESS_WINDOW_MS) return;
    const needed = Math.max(1, Math.min(MIN_PROGRESS_BYTES, max - windowBytes));
    if (seen - windowBytes < needed) return fail(new BodyStalledError());
    waited = 0;
    if (waitingSince) waitingSince = now;
    windowBytes = seen;
  }, PROGRESS_CHECK_MS);

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        output = controller;
      },
      async pull(controller) {
        waitingSince = Date.now();
        let result: Awaited<ReturnType<typeof reader.read>>;
        try {
          result = await reader.read();
        } finally {
          waited += Date.now() - waitingSince;
          waitingSince = 0;
        }
        // A stall failed the stream while the read waited.
        if (ended) return;
        if (result.done) {
          controller.close();
          return;
        }
        seen += result.value.byteLength;
        if (seen > max) fail(new BodyTooLargeError());
        else controller.enqueue(result.value);
      },
      // Storage gave up, so the sender's body is let go of too.
      cancel(reason) {
        return reader.cancel(reason);
      },
    },
    // Read only when storage asks, so a body storage holds back is not read ahead and timed.
    { highWaterMark: 0 },
  );
  return { stream, stop };
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

    // Stream the encrypted body to storage, never more than it declared and only while it keeps
    // coming. A failed save aborts the multipart upload on S3, the delete removes a partial file.
    const guarded = guardedBody(body, headers.contentLength);
    let bytesWritten: number;
    try {
      bytesWritten = await storage.save(id, guarded.stream, headers.contentLength);
    } catch (err) {
      // Clean up partial file on error
      await storage.delete(id).catch(() => {});
      if (err instanceof BodyTooLargeError) {
        return c.json({ error: "Body size does not match declared content length" }, 413);
      }
      // The quota middleware gives the reservation back for this answer. Closing the
      // connection keeps a sender that still trickles from holding the socket as well.
      if (err instanceof BodyStalledError) {
        return c.json({ error: "Upload timed out" }, 408, { Connection: "close" });
      }
      throw err;
    } finally {
      guarded.stop();
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
