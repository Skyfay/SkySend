import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, rmSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Context } from "hono";
import { getConfig } from "./config.js";
import type { StorageBackend } from "../storage/types.js";

/** Largest chunk body. The web app and the CLI send about 10 MiB. */
export const MAX_CHUNK_SIZE = 16 * 1024 * 1024;

/** A session that does not finish within this time is dropped. */
const SESSION_TTL_MS = 60 * 60 * 1000;

/** How often dropped sessions are looked for. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Most chunks a session keeps waiting for an earlier one. A client sends a few in parallel,
 * so far fewer wait in practice. The cap keeps a session from filling chunkDir with files.
 */
const MAX_PENDING_CHUNKS = 64;

/** The longest a session can stay open: its TTL plus the wait for the next sweep. */
export const SESSION_MAX_LIFETIME_MS = SESSION_TTL_MS + SWEEP_INTERVAL_MS;

export interface ChunkedUploadOptions<M> {
  /**
   * Where chunk bodies wait until they are appended in order. Emptied when the
   * sessions are created, so it must belong to this set of sessions alone.
   */
  chunkDir: string;
  /** Overrides MAX_CHUNK_SIZE in tests. */
  maxChunkSize?: number;
  /** Runs when a session is dropped without being finished, by an error or the timeout. */
  onAbandon?: (id: string, meta: M) => void;
}

/** A chunked upload once all its bytes arrived. */
export interface FinishedChunkedUpload<M> {
  meta: M;
  contentLength: number;
  bytesWritten: number;
}

interface UploadSession<M> {
  meta: M;
  /** The size the client declared at init. */
  contentLength: number;
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

/**
 * The session layer of chunked uploads, shared by normal uploads and uploads into a file
 * request, so both get the same limits.
 *
 * Chunk bodies never stay in memory. Each one is streamed into a file in chunkDir and
 * appended from there, so a session holds only bookkeeping. The limits are checked per
 * read (GHSA-9rmm-v3p2-c26g): a chunk is at most maxChunkSize and never larger than the
 * declared upload, all chunks of a session stay within the declared size, each index is
 * accepted once, and a session has at most FILE_UPLOAD_CONCURRENT_CHUNKS requests in flight.
 */
export function createChunkedUploads<M>(
  storage: StorageBackend,
  { chunkDir, maxChunkSize = MAX_CHUNK_SIZE, onAbandon }: ChunkedUploadOptions<M>,
) {
  // Chunk files left behind by a crash belong to sessions that no longer exist.
  rmSync(chunkDir, { recursive: true, force: true });
  mkdirSync(chunkDir, { recursive: true });

  const sessions = new Map<string, UploadSession<M>>();

  /** Removes a session and the chunk files it still has in chunkDir. */
  function dropSession(id: string): void {
    sessions.delete(id);
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

  /** Drops an unfinished session, aborts its storage upload and tells the owner. */
  async function abandon(id: string, session: UploadSession<M>): Promise<void> {
    dropSession(id);
    onAbandon?.(id, session.meta);
    // An append still running would otherwise write into the upload after the abort.
    await session.writePromise.catch(() => {});
    await storage.abortChunkedUpload(id).catch(() => {});
  }

  // Clean up stale sessions every 10 minutes (sessions older than 1 hour)
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) void abandon(id, session);
    }
  }, SWEEP_INTERVAL_MS).unref();

  return {
    /** Opens a session for an upload of `contentLength` bytes and returns its new ID. */
    async open(contentLength: number, meta: M): Promise<string> {
      const id = randomUUID();
      await storage.createEmpty(id);
      sessions.set(id, {
        meta,
        contentLength,
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
      return id;
    },

    /** Ends a session the client gave up on, as the timeout would. False if there is none. */
    async abort(id: string): Promise<boolean> {
      const session = sessions.get(id);
      if (!session) return false;
      await abandon(id, session);
      return true;
    },

    /** The metadata of an open session, if there is one. */
    meta(id: string): M | undefined {
      return sessions.get(id)?.meta;
    },

    /**
     * Handles POST <...>/:id/chunk?index=N for an open session. Chunks may arrive out of
     * order (parallel uploads from the client). Each body is streamed into a file in
     * chunkDir, and the files are appended to the storage backend in index order.
     */
    async receiveChunk(c: Context, id: string): Promise<Response> {
      const session = sessions.get(id);
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
      const chunkLimit = Math.min(maxChunkSize, session.contentLength);
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
      if (
        session.pendingChunks.size >= MAX_PENDING_CHUNKS &&
        chunkIndex !== session.nextWriteIndex
      ) {
        return c.json({ error: "Too many chunks waiting for an earlier one" }, 429);
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
                } else if (session.bytesReceived + piece.byteLength > session.contentLength) {
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
        // An empty chunk adds nothing but a file, and nothing would ever bound how many.
        if (received === 0) return c.json({ error: "Empty chunk" }, 400);

        // The session may have failed or expired while the body was read.
        if (sessions.get(id) !== session) {
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

            if (session.bytesWritten > session.contentLength) {
              throw new Error(`Chunk ${writeIndex}: total bytes exceed declared content length`);
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
        if (sessions.get(id) === session) await abandon(id, session);
        throw err;
      } finally {
        session.activeRequests--;
        session.receivingChunks.delete(chunkIndex);
        if (!kept) {
          session.bytesReceived -= received;
          await rm(chunkPath, { force: true });
        }
      }
    },

    /**
     * Ends a session for finalize and hands back what it collected, or undefined if there
     * is no such session. Waits for appends still running, so none of them touches the
     * storage upload afterwards. The caller then owns it: it either finalizes or aborts it.
     */
    async take(id: string): Promise<FinishedChunkedUpload<M> | undefined> {
      const session = sessions.get(id);
      if (!session) return undefined;
      dropSession(id);
      await session.writePromise.catch(() => {});
      return {
        meta: session.meta,
        contentLength: session.contentLength,
        bytesWritten: session.bytesWritten,
      };
    },
  };
}
