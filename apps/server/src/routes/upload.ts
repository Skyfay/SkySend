import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, rmSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { fromBase64url } from "@skysend/crypto";
import type { StorageBackend } from "../storage/types.js";
import type { QuotaVariables } from "../types.js";
import { uploadHeadersSchema, validateUploadHeaders } from "../lib/upload-validation.js";

/** Largest chunk body. The web app and the CLI send about 10 MiB. */
export const MAX_CHUNK_SIZE = 16 * 1024 * 1024;

export interface UploadRouteOptions {
  /**
   * Where chunk bodies wait until they are appended in order. Emptied when the
   * route is created, so it must belong to this server alone.
   */
  chunkDir: string;
  /** Overrides MAX_CHUNK_SIZE in tests. */
  maxChunkSize?: number;
}

export function createUploadRoute(
  storage: StorageBackend,
  { chunkDir, maxChunkSize = MAX_CHUNK_SIZE }: UploadRouteOptions,
) {
  const route = new Hono<{ Variables: QuotaVariables }>();

  // Chunk files left behind by a crash belong to sessions that no longer exist.
  rmSync(chunkDir, { recursive: true, force: true });
  mkdirSync(chunkDir, { recursive: true });

  // ── In-memory tracker for chunked uploads ────────
  // Maps upload ID -> session data. Cleaned up on finalize or timeout.
  // Chunk bodies never stay in memory. Each one is streamed into a file in
  // chunkDir and appended from there, so a session holds only bookkeeping.

  interface UploadSession {
    headers: z.infer<typeof uploadHeadersSchema>;
    bytesWritten: number;
    createdAt: number;
    /** Chunks received out-of-order, waiting in chunkDir to be appended. */
    pendingChunks: Map<number, string>;
    /** Chunk indexes whose bodies are being received right now. */
    receivingChunks: Set<number>;
    /** Bytes of all chunks received or being received. Never above the declared size. */
    bytesReceived: number;
    /** Next chunk index the storage backend expects. */
    nextWriteIndex: number;
    /** Serialization chain - ensures appendChunk calls are never concurrent. */
    writePromise: Promise<void>;
    /** Timestamp (ms) of the first chunk received - for speed limiting. */
    firstChunkAt: number;
    /** Chunk requests of this session that are currently being handled. */
    activeRequests: number;
  }
  const pendingSessions = new Map<string, UploadSession>();

  /** Removes a session and the chunk files it still has in chunkDir. */
  function dropSession(id: string): void {
    pendingSessions.delete(id);
    readdir(chunkDir)
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(`${id}.`))
            .map((name) => rm(join(chunkDir, name), { force: true })),
        ),
      )
      .catch(() => {});
  }

  // Clean up stale sessions every 10 minutes (sessions older than 1 hour)
  const SESSION_TTL_MS = 60 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of pendingSessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        dropSession(id);
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
      receivingChunks: new Set(),
      bytesReceived: 0,
      nextWriteIndex: 0,
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
   * Each body is streamed into a file in chunkDir, and the files are appended
   * to the storage backend in index order to guarantee data integrity.
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

    // ── Checks that need no body ─────────────────────
    // A chunk is never larger than maxChunkSize or the declared upload, each
    // index arrives once, and a session never has more requests in flight than
    // a client sends in parallel (GHSA-9rmm-v3p2-c26g).
    const chunkLimit = Math.min(maxChunkSize, session.headers.contentLength);
    if (Number(c.req.header("Content-Length")) > chunkLimit) {
      return c.json({ error: "Chunk too large" }, 413);
    }
    if (
      chunkIndex < session.nextWriteIndex ||
      session.pendingChunks.has(chunkIndex) ||
      session.receivingChunks.has(chunkIndex)
    ) {
      return c.json({ error: "Chunk already received" }, 409);
    }
    if (session.activeRequests >= getConfig().FILE_UPLOAD_CONCURRENT_CHUNKS) {
      return c.json({ error: "Too many parallel chunk requests" }, 429);
    }

    session.activeRequests++;
    session.receivingChunks.add(chunkIndex);
    const chunkPath = join(chunkDir, `${id}.${chunkIndex}`);
    /** Bytes of this body counted in session.bytesReceived. */
    let received = 0;
    /** Why the body was cut off, answered with 413. */
    let tooLarge: string | null = null;
    /** Whether the session took over the chunk file. */
    let kept = false;
    try {
      // Record when the first chunk arrives (for speed limiting)
      if (session.firstChunkAt === 0) {
        session.firstChunkAt = Date.now();
      }

      // ── Always consume the request body immediately ──────────────────
      // With parallel uploads over HTTP/2 through proxies (Traefik, Caddy),
      // deferring body reads causes flow-control deadlocks: the proxy waits
      // to forward the body, but the server isn't reading it because it's
      // queued behind another write. Streaming it into a file reads it at
      // once without holding it in memory. The limits are checked per read,
      // so an oversized body is cut off instead of being read in full.
      try {
        await pipeline(
          Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
          async function* (source: AsyncIterable<Buffer>) {
            for await (const piece of source) {
              if (received + piece.byteLength > chunkLimit) {
                tooLarge = "Chunk too large";
              } else if (
                session.bytesReceived + piece.byteLength >
                session.headers.contentLength
              ) {
                tooLarge = "Chunks exceed the declared content length";
              }
              if (tooLarge) throw new Error(tooLarge);
              received += piece.byteLength;
              session.bytesReceived += piece.byteLength;
              yield piece;
            }
          },
          createWriteStream(chunkPath),
        );
      } catch (err) {
        if (tooLarge) return c.json({ error: tooLarge }, 413);
        throw err;
      }

      // The session may have failed or expired while the body was read.
      if (pendingSessions.get(id) !== session) {
        return c.json({ error: "Upload session not found or expired" }, 404);
      }

      session.pendingChunks.set(chunkIndex, chunkPath);
      kept = true;

      // Append all consecutive chunks starting from nextWriteIndex
      while (session.pendingChunks.has(session.nextWriteIndex)) {
        const path = session.pendingChunks.get(session.nextWriteIndex)!;
        session.pendingChunks.delete(session.nextWriteIndex);
        const writeIndex = session.nextWriteIndex;
        session.nextWriteIndex++;

        // Chain the write to ensure sequential, non-concurrent appendChunk calls
        session.writePromise = session.writePromise.then(async () => {
          const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
          const bytesAppended = await storage.appendChunk(id, stream);
          await rm(path, { force: true });
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
      dropSession(id);
      await storage.abortChunkedUpload(id).catch(() => {});
      throw err;
    } finally {
      session.activeRequests--;
      session.receivingChunks.delete(chunkIndex);
      if (!kept) {
        session.bytesReceived -= received;
        await rm(chunkPath, { force: true });
      }
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

    dropSession(id);
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
