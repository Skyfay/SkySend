import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { fromBase64url, SALT_LENGTH } from "@skysend/crypto";
import type { StorageBackend } from "../storage/types.js";
import type { QuotaVariables } from "../types.js";
import type { Config } from "../lib/config.js";

const base64urlPattern = /^[A-Za-z0-9_-]+$/;

const uploadHeadersSchema = z.object({
  authToken: z.string().regex(base64urlPattern, "Invalid base64url"),
  ownerToken: z.string().regex(base64urlPattern, "Invalid base64url"),
  salt: z.string().regex(base64urlPattern, "Invalid base64url"),
  maxDownloads: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  expireSec: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  fileCount: z
    .string()
    .default("1")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  contentLength: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  hasPassword: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  passwordSalt: z.string().regex(base64urlPattern).optional(),
  passwordAlgo: z.enum(["argon2id", "pbkdf2"]).optional(),
});

type UploadHeaders = z.infer<typeof uploadHeadersSchema>;

/** Validate parsed upload headers against server config. Returns null if valid. */
function validateUploadHeaders(
  headers: UploadHeaders,
  config: Config,
): { message: string; status: 400 | 413 } | null {
  // Validate salt length
  try {
    const saltBytes = fromBase64url(headers.salt);
    if (saltBytes.length !== SALT_LENGTH) {
      return { message: `Salt must be exactly ${SALT_LENGTH} bytes`, status: 400 };
    }
  } catch {
    return { message: "Invalid salt encoding", status: 400 };
  }

  if (headers.contentLength > config.FILE_MAX_SIZE) {
    return { message: `File size exceeds maximum of ${config.FILE_MAX_SIZE} bytes`, status: 413 };
  }

  if (headers.fileCount > config.FILE_MAX_FILES_PER_UPLOAD) {
    return { message: `Maximum ${config.FILE_MAX_FILES_PER_UPLOAD} files per upload`, status: 400 };
  }

  if (!config.FILE_EXPIRE_OPTIONS_SEC.includes(headers.expireSec)) {
    return { message: "Invalid expiry time. Must be one of the allowed options.", status: 400 };
  }

  if (!config.FILE_DOWNLOAD_OPTIONS.includes(headers.maxDownloads)) {
    return { message: "Invalid download limit. Must be one of the allowed options.", status: 400 };
  }

  if (headers.hasPassword) {
    if (!headers.passwordSalt || !headers.passwordAlgo) {
      return {
        message: "Password-protected uploads require X-Password-Salt and X-Password-Algo",
        status: 400,
      };
    }
    try {
      const pwSaltBytes = fromBase64url(headers.passwordSalt);
      if (pwSaltBytes.length !== SALT_LENGTH) {
        return { message: `Password salt must be exactly ${SALT_LENGTH} bytes`, status: 400 };
      }
    } catch {
      return { message: "Invalid password salt encoding", status: 400 };
    }
  }

  return null;
}

export function createUploadRoute(storage: StorageBackend) {
  const route = new Hono<{ Variables: QuotaVariables }>();

  // ── In-memory tracker for chunked uploads ────────
  // Maps upload ID -> session data. Cleaned up on finalize or timeout.

  /** Max bytes buffered in memory for out-of-order chunks per session. */
  const MAX_BUFFER_PER_SESSION = 50 * 1024 * 1024; // 50 MB

  interface UploadSession {
    headers: z.infer<typeof uploadHeadersSchema>;
    bytesWritten: number;
    createdAt: number;
    /** Chunks received out-of-order, waiting to be written. */
    pendingChunks: Map<number, Uint8Array>;
    /** Next chunk index the storage backend expects. */
    nextWriteIndex: number;
    /** Total bytes held in pendingChunks (for memory limiting). */
    bufferedBytes: number;
    /** Serialization chain - ensures appendChunk calls are never concurrent. */
    writePromise: Promise<void>;
  }
  const pendingSessions = new Map<string, UploadSession>();

  // Clean up stale sessions every 10 minutes (sessions older than 1 hour)
  const SESSION_TTL_MS = 60 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of pendingSessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        pendingSessions.delete(id);
        storage.abortChunkedUpload(id).catch(() => {});
      }
    }
  }, 10 * 60 * 1000).unref();

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

    const id = randomUUID();

    // Create empty file on disk
    await storage.createEmpty(id);

    // Track session
    pendingSessions.set(id, {
      headers,
      bytesWritten: 0,
      createdAt: Date.now(),
      pendingChunks: new Map(),
      nextWriteIndex: 0,
      bufferedBytes: 0,
      writePromise: Promise.resolve(),
    });

    return c.json({ id }, 201);
  });

  /**
   * POST /api/upload/:id/chunk?index=N
   * Append a chunk of encrypted data to a pending upload.
   * Chunks may arrive out-of-order (parallel uploads from the client).
   * The server buffers out-of-order chunks and writes them sequentially
   * to the storage backend to guarantee data integrity.
   */
  route.post("/:id/chunk", async (c) => {
    const id = c.req.param("id");
    const session = pendingSessions.get(id);
    if (!session) {
      return c.json({ error: "Upload session not found or expired" }, 404);
    }

    // Parse chunk index from query string
    const indexParam = c.req.query("index");
    const chunkIndex = indexParam !== undefined ? parseInt(indexParam, 10) : -1;
    if (isNaN(chunkIndex) || chunkIndex < 0) {
      return c.json({ error: "Missing or invalid chunk index" }, 400);
    }

    const body = c.req.raw.body;
    if (!body) {
      return c.json({ error: "Missing chunk body" }, 400);
    }

    try {
      // Read the incoming stream into a Uint8Array
      const reader = body.getReader();
      const parts: Uint8Array[] = [];
      let totalBytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        totalBytes += value.byteLength;
      }
      const chunkData = new Uint8Array(totalBytes);
      let offset = 0;
      for (const part of parts) {
        chunkData.set(part, offset);
        offset += part.byteLength;
      }

      // Memory guard: reject if buffering too much out-of-order data
      if (
        chunkIndex !== session.nextWriteIndex &&
        session.bufferedBytes + totalBytes > MAX_BUFFER_PER_SESSION
      ) {
        return c.json({ error: "Too many out-of-order chunks buffered" }, 429);
      }

      // Store the chunk (may be in-order or out-of-order)
      session.pendingChunks.set(chunkIndex, chunkData);
      session.bufferedBytes += totalBytes;

      // Flush all consecutive chunks starting from nextWriteIndex
      // through the serialized write promise chain.
      while (session.pendingChunks.has(session.nextWriteIndex)) {
        const data = session.pendingChunks.get(session.nextWriteIndex)!;
        session.pendingChunks.delete(session.nextWriteIndex);
        session.bufferedBytes -= data.byteLength;
        const writeIndex = session.nextWriteIndex;
        session.nextWriteIndex++;

        // Chain the write to ensure sequential, non-concurrent appendChunk calls
        session.writePromise = session.writePromise.then(async () => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(data);
              controller.close();
            },
          });
          const bytesAppended = await storage.appendChunk(id, stream);
          session.bytesWritten += bytesAppended;

          // Safety check: don't exceed declared content length
          if (session.bytesWritten > session.headers.contentLength) {
            throw new Error(
              `Chunk ${writeIndex}: total bytes exceed declared content length`,
            );
          }
        });
      }

      // Wait for all writes triggered by this request to complete
      await session.writePromise;

      return c.json({ bytesWritten: session.bytesWritten }, 200);
    } catch (err) {
      pendingSessions.delete(id);
      await storage.abortChunkedUpload(id).catch(() => {});
      throw err;
    }
  });

  /**
   * POST /api/upload/:id/finalize
   * Finalize a chunked upload: verify total bytes match and create DB record.
   */
  route.post("/:id/finalize", async (c) => {
    const id = c.req.param("id");
    const session = pendingSessions.get(id);
    if (!session) {
      return c.json({ error: "Upload session not found or expired" }, 404);
    }

    pendingSessions.delete(id);
    const { headers } = session;

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

    // Record quota usage if applicable
    const quotaHashedIp = c.get("quotaHashedIp");
    if (quotaHashedIp) {
      const quotaRecorder = c.get("quotaRecorder");
      if (quotaRecorder) {
        quotaRecorder(quotaHashedIp, session.bytesWritten);
      }
    }

    return c.json({ id }, 200);
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

    // Stream the encrypted body to disk
    let bytesWritten: number;
    try {
      bytesWritten = await storage.save(id, body);
    } catch (err) {
      // Clean up partial file on error
      await storage.delete(id).catch(() => {});
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

    // Record quota usage if applicable
    const quotaHashedIp = c.get("quotaHashedIp");
    if (quotaHashedIp) {
      const quotaRecorder = c.get("quotaRecorder");
      if (quotaRecorder) {
        quotaRecorder(quotaHashedIp, bytesWritten);
      }
    }

    return c.json({
      id,
      url: `${config.BASE_URL}/#${id}`,
    }, 201);
  });

  return route;
}
