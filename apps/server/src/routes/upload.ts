import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { fromBase64url } from "@skysend/crypto";
import type { StorageBackend } from "../storage/types.js";
import type { QuotaVariables } from "../types.js";
import { uploadHeadersSchema, validateUploadHeaders } from "../lib/upload-validation.js";

/**
 * Memory limits of the chunked upload. The chunk route reads every body into
 * memory before it writes it, so these bound what a request, a session, and all
 * sessions together can hold. Tests pass smaller ones.
 */
export const CHUNK_LIMITS = {
  /** Largest chunk body. The web app and the CLI send about 10 MiB. */
  maxChunkSize: 16 * 1024 * 1024,
  /** Out-of-order chunks one session may buffer. */
  maxBufferPerSession: 50 * 1024 * 1024,
  /** Chunk bytes all sessions together may hold, while being read or buffered. */
  maxTotalMemory: 512 * 1024 * 1024,
};

export function createUploadRoute(storage: StorageBackend, limits = CHUNK_LIMITS) {
  const route = new Hono<{ Variables: QuotaVariables }>();

  // ── In-memory tracker for chunked uploads ────────
  // Maps upload ID -> session data. Cleaned up on finalize or timeout.

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
    /** Timestamp (ms) of the first chunk received - for speed limiting. */
    firstChunkAt: number;
    /** Chunk requests of this session that are currently being handled. */
    activeRequests: number;
  }
  const pendingSessions = new Map<string, UploadSession>();
  /** Chunk bytes held across all sessions: bodies being read plus out-of-order buffers. */
  let chunkMemory = 0;

  /** Removes a session and frees the out-of-order chunks it still holds. */
  function dropSession(id: string, session: UploadSession): void {
    pendingSessions.delete(id);
    chunkMemory -= session.bufferedBytes;
    session.bufferedBytes = 0;
    session.pendingChunks.clear();
  }

  // Clean up stale sessions every 10 minutes (sessions older than 1 hour)
  const SESSION_TTL_MS = 60 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of pendingSessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        dropSession(id, session);
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
      firstChunkAt: 0,
      activeRequests: 0,
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

    // ── Bound the memory of this chunk before reading it ──────────
    // The body is read into memory below. A chunk is never larger than
    // maxChunkSize or the declared upload, never arrives twice, and a session
    // never has more requests in flight than a client sends in parallel.
    const maxChunkSize = Math.min(limits.maxChunkSize, session.headers.contentLength);
    if (Number(c.req.header("Content-Length")) > maxChunkSize) {
      return c.json({ error: "Chunk too large" }, 413);
    }
    if (chunkIndex < session.nextWriteIndex || session.pendingChunks.has(chunkIndex)) {
      return c.json({ error: "Chunk already received" }, 409);
    }
    if (session.activeRequests >= getConfig().FILE_UPLOAD_CONCURRENT_CHUNKS) {
      return c.json({ error: "Too many parallel chunk requests" }, 429);
    }

    session.activeRequests++;
    // Bytes of this body counted in chunkMemory until the session buffer takes them.
    let reading = 0;
    try {
      // Record when the first chunk arrives (for speed limiting)
      if (session.firstChunkAt === 0) {
        session.firstChunkAt = Date.now();
      }

      // ── Always consume the request body immediately ──────────────────
      // With parallel uploads over HTTP/2 through proxies (Traefik, Caddy),
      // deferring body reads causes flow-control deadlocks: the proxy waits
      // to forward the body, but the server isn't reading it because it's
      // queued behind another write.  Reading into memory first avoids this.
      // The limits are checked per read, so an oversized body is cut off
      // instead of being read in full first.
      const reader = body.getReader();
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (reading + value.byteLength > maxChunkSize) {
          await reader.cancel();
          return c.json({ error: "Chunk too large" }, 413);
        }
        if (chunkMemory + value.byteLength > limits.maxTotalMemory) {
          await reader.cancel();
          return c.json({ error: "Server is busy, try again later" }, 503);
        }
        chunkMemory += value.byteLength;
        reading += value.byteLength;
        parts.push(value);
      }
      const totalBytes = reading;

      // The session may have failed, or the same chunk arrived, while this body was read.
      if (pendingSessions.get(id) !== session) {
        return c.json({ error: "Upload session not found or expired" }, 404);
      }
      if (chunkIndex < session.nextWriteIndex || session.pendingChunks.has(chunkIndex)) {
        return c.json({ error: "Chunk already received" }, 409);
      }

      // Memory guard: reject if buffering too much out-of-order data
      if (session.bufferedBytes + totalBytes > limits.maxBufferPerSession) {
        return c.json({ error: "Too many out-of-order chunks buffered" }, 429);
      }

      // Concatenate parts into a single buffer
      const chunkData = new Uint8Array(totalBytes);
      let offset = 0;
      for (const part of parts) {
        chunkData.set(part, offset);
        offset += part.byteLength;
      }

      // Store the chunk (may be in-order or out-of-order). Its bytes stay in
      // chunkMemory, now on behalf of the session buffer.
      session.pendingChunks.set(chunkIndex, chunkData);
      session.bufferedBytes += totalBytes;
      reading = 0;

      // Flush all consecutive chunks starting from nextWriteIndex
      while (session.pendingChunks.has(session.nextWriteIndex)) {
        const data = session.pendingChunks.get(session.nextWriteIndex)!;
        session.pendingChunks.delete(session.nextWriteIndex);
        session.bufferedBytes -= data.byteLength;
        chunkMemory -= data.byteLength;
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

          if (session.bytesWritten > session.headers.contentLength) {
            throw new Error(
              `Chunk ${writeIndex}: total bytes exceed declared content length`,
            );
          }
        });
      }

      // Wait for all writes triggered by this request to complete
      await session.writePromise;

      // ── Speed limit: delay response if uploading too fast ──────────
      const speedLimit = getConfig().FILE_UPLOAD_SPEED_LIMIT;
      if (speedLimit > 0 && session.bytesWritten > 0) {
        const elapsedMs = Date.now() - session.firstChunkAt;
        const expectedMs = (session.bytesWritten / speedLimit) * 1000;
        const delayMs = expectedMs - elapsedMs;
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      return c.json({ bytesWritten: session.bytesWritten }, 200);
    } catch (err) {
      dropSession(id, session);
      await storage.abortChunkedUpload(id).catch(() => {});
      throw err;
    } finally {
      session.activeRequests--;
      chunkMemory -= reading;
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

    dropSession(id, session);
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
