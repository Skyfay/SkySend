import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import { getConfig } from "./config.js";
import { getClientIp } from "../middleware/rate-limit.js";
import type { StorageBackend } from "../storage/types.js";
import type { QuotaReservation } from "../middleware/quota.js";
// The same progress rule as chunked HTTP sessions.
import { MIN_PROGRESS_BYTES, PROGRESS_WINDOW_MS } from "./chunked-upload.js";
import { describeError } from "./log-error.js";

/**
 * The session layer of WebSocket uploads, shared by normal uploads and uploads into a file
 * request, so both get the same framing, buffering, backpressure and finalize handling.
 *
 * Protocol:
 *   1. Client connects.
 *   2. Client sends a JSON text frame {"type":"init", ...}. The target checks it and
 *      claims what it needs, then the server creates an empty storage entry and replies
 *      {"type":"ready", id}.
 *   3. Client sends contiguous binary frames containing ciphertext.
 *      WebSocket preserves ordering so no per-frame index is needed.
 *   4. Client sends a JSON text frame {"type":"finalize", ...}.
 *   5. Server verifies bytesWritten === contentLength, finalizes storage, lets the target
 *      store the row, commits the quota, replies {"type":"done", id} plus what the target adds
 *      and closes with code 1000.
 *
 * Errors close the socket with code 1011 and an {"type":"error", message} frame. Abnormal
 * closes before finalize abort the storage entry and hand the target its claim back and the
 * quota its reservation.
 */

/** Why a target refused. `status` is the HTTP status the same refusal has over HTTP. */
export interface WsUploadRefusal {
  error: string;
  code: number;
  status?: number;
}

/** What an upload of one kind adds to the shared session layer. */
export interface WsUploadTarget<M> {
  /**
   * Checks the init message and claims what the upload needs. Returns the refusal, or the
   * declared size, what the session keeps until finalize and the quota reservation. A target
   * that refuses after it reserved gives the reservation back itself.
   */
  open(
    init: Record<string, unknown>,
    ctx: { c: Context; ip: string },
  ): Promise<
    WsUploadRefusal | { contentLength: number; meta: M; quotaReservation: QuotaReservation | null }
  >;
  /**
   * Stores the upload once all its bytes are in storage. A refusal deletes the blob, a reply
   * travels in the done frame.
   */
  commit(
    session: { id: string; bytesReceived: number; meta: M },
    finalize: Record<string, unknown>,
  ): Promise<WsUploadRefusal | { reply?: Record<string, unknown> } | void>;
  /** Gives back what open claimed, when the session ends without a commit. */
  abandon?(meta: M): void;
}

type Stage = "receiving" | "finalizing" | "closed";

/** The stage of a session read anew, since another handler may change it during an await. */
const stageOf = (session: { stage: Stage }): Stage => session.stage;

interface Session<M> {
  id: string;
  stage: Stage;
  meta: M;
  contentLength: number;
  quotaReservation: QuotaReservation | null;
  bytesReceived: number;
  firstFrameAt: number;
  /** Buffered frames waiting to be flushed to storage. */
  buffer: Uint8Array[];
  bufferSize: number;
  /** Bytes currently being written to storage (in-flight flushes). */
  pendingWriteSize: number;
  /** Serialised write chain - guarantees sequential appendChunk calls. */
  writePromise: Promise<void>;
  /** Set when the receive buffer exceeds the configured cap. */
  backpressureError: Error | null;
  /** Whether the underlying TCP socket is paused for backpressure. */
  paused: boolean;
  /** Set when the socket closed while finalize was running, so finalize does not commit. */
  clientGone: boolean;
  /** Start of the current progress window and the bytes received when it began. */
  windowStart: number;
  windowBytes: number;
  progressTimer: ReturnType<typeof setInterval> | null;
  /** Writes out a buffer that sat below the flush threshold, see FLUSH_DELAY_MS. */
  flushTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Stands in for a session while its init is checked. Init awaits the target and storage,
 * and a socket can close or send more frames meanwhile, which `gone` records.
 */
interface PendingInit {
  stage: "awaiting-init";
  gone: boolean;
}

/**
 * A buffer below the flush threshold is written out this long after its first frame at the
 * latest, so a sender that stops short of the threshold cannot keep it in memory.
 */
const FLUSH_DELAY_MS = 1000;

export interface WsUploadDeps {
  storage: StorageBackend;
  upgradeWebSocket: UpgradeWebSocket;
}

function isRefusal(value: unknown): value is WsUploadRefusal {
  return typeof value === "object" && value !== null && "error" in value;
}

/** Builds the WebSocket handler of one kind of upload. */
export function createWsUploadHandler<M>(deps: WsUploadDeps, target: WsUploadTarget<M>) {
  const { storage, upgradeWebSocket } = deps;

  /** Threshold above which buffered frames are flushed to storage. */
  const FLUSH_THRESHOLD = 4 * 1024 * 1024; // 4 MB

  const sessions = new WeakMap<WSContext, Session<M> | PendingInit>();

  /**
   * Flush pre-detached chunks to storage.
   * The caller must detach the buffer synchronously and pass the chunks here
   * so that new frames accumulate into a fresh buffer while this write is
   * in-flight.  This is critical for slow backends (S3) where appendChunk
   * involves network I/O.
   */
  async function flushChunks(
    session: Session<M>,
    chunks: Uint8Array[],
    total: number,
  ): Promise<void> {
    if (total === 0) return;
    // Skip write if the session was already closed/aborted.
    if (session.stage === "closed") {
      session.pendingWriteSize -= total;
      return;
    }
    try {
      const combined = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        combined.set(c, offset);
        offset += c.byteLength;
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(combined);
          controller.close();
        },
      });
      await storage.appendChunk(session.id, stream);
    } finally {
      session.pendingWriteSize -= total;
    }
  }

  /**
   * Pause the underlying TCP socket to stop frame delivery.
   * Uses the raw ws.WebSocket from @hono/node-ws which exposes
   * pause()/resume() for stream-level backpressure.
   */
  function pauseSocket(ws: WSContext): void {
    try {
      const raw = ws.raw as { pause?: () => void } | undefined;
      raw?.pause?.();
    } catch {
      /* not all adapters support this */
    }
  }

  /** Resume a previously paused socket. */
  function resumeSocket(ws: WSContext): void {
    try {
      const raw = ws.raw as { resume?: () => void } | undefined;
      raw?.resume?.();
    } catch {
      /* ignore */
    }
  }

  function sendJson(ws: WSContext, payload: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Socket already closed - ignore.
    }
  }

  function stopTimers(session: Session<M>): void {
    if (session.progressTimer) clearInterval(session.progressTimer);
    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.progressTimer = null;
    session.flushTimer = null;
  }

  /**
   * Ends a session that did not commit: aborts its storage entry and gives the claim back.
   * A write that is running finishes first, so it cannot bring the file back after the abort.
   */
  function close(session: Session<M>): Promise<void> {
    session.stage = "closed";
    stopTimers(session);
    target.abandon?.(session.meta);
    session.quotaReservation?.release();
    return session.writePromise
      .catch(() => {})
      .then(() => storage.abortChunkedUpload(session.id))
      .catch(() => {});
  }

  /**
   * Hands the buffer to the write chain. It is detached synchronously, so new frames collect
   * in a fresh buffer while the write, which may be slow on S3, is in flight.
   */
  function flushBuffer(session: Session<M>, ws: WSContext, maxBuffer: number): void {
    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.flushTimer = null;
    if (session.bufferSize === 0) return;
    const chunksToFlush = session.buffer;
    const sizeToFlush = session.bufferSize;
    session.buffer = [];
    session.bufferSize = 0;
    session.pendingWriteSize += sizeToFlush;

    const resumeThreshold = maxBuffer * 0.5;
    session.writePromise = session.writePromise
      .then(() => flushChunks(session, chunksToFlush, sizeToFlush))
      .then(() => {
        // Resume socket once memory pressure has eased.
        if (session.paused) {
          const current = session.bufferSize + session.pendingWriteSize;
          if (current < resumeThreshold) {
            session.paused = false;
            resumeSocket(ws);
          }
        }
      })
      .catch((err) => {
        // Store the error for the finalize handler to detect.
        // Do NOT re-throw: that would create an unhandled rejection
        // and crash Node.js when the writePromise chain continues
        // after an abort.
        if (session.stage !== "closed") {
          session.backpressureError = err instanceof Error ? err : new Error(String(err));
        }
      });
  }

  function fail(
    ws: WSContext,
    session: Session<M> | undefined,
    message: string,
    code = 1011,
    status?: number,
  ): void {
    sendJson(
      ws,
      status === undefined ? { type: "error", message } : { type: "error", message, status },
    );
    if (session && session.stage !== "closed") {
      // Resume socket if paused so the close frame can be sent.
      if (session.paused) {
        session.paused = false;
        resumeSocket(ws);
      }
      void close(session);
    }
    try {
      ws.close(code, message.slice(0, 120));
    } catch {
      // ignore
    }
  }

  function parseJson(data: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(data);
      // Valid JSON that is not an object fails on its missing type further down.
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return null;
    }
  }

  return upgradeWebSocket((c) => {
    const config = getConfig();
    const ip = getClientIp(c, config.TRUST_PROXY);

    // Defence-in-depth: validate Origin on the upgrade request.
    // The CORS middleware sets headers but cannot block a WS upgrade,
    // so we check manually to prevent cross-site quota-waste attacks.
    const origin = c.req.header("origin") ?? "";
    const allowed = [config.BASE_URL, ...config.CORS_ORIGINS];
    // L-3 (Security Audit): Empty origin is intentionally allowed.
    // Non-browser clients (curl, the SkySend CLI) do not send an Origin header.
    // For a self-hosted file-sharing tool, CLI access is a first-class use case.
    // The upload still goes through quota enforcement and session validation.
    const originAllowed = origin === "" || allowed.includes(origin);

    return {
      onOpen: (_evt, ws) => {
        if (!originAllowed) {
          sendJson(ws, { type: "error", message: "Origin not allowed" });
          try {
            ws.close(1008, "Origin not allowed");
          } catch {
            /* ignore */
          }
        }
      },

      onMessage: async (evt, ws) => {
        if (!originAllowed) return;
        const data = evt.data;
        const entry = sessions.get(ws);

        // A frame that arrives while the init is still being checked breaks the protocol.
        if (entry?.stage === "awaiting-init") {
          entry.gone = true;
          fail(ws, undefined, "Unexpected message before ready", 1002);
          return;
        }
        let session = entry;

        // ── Init message (text JSON) ────────────────────
        if (!session) {
          if (typeof data !== "string") {
            fail(ws, undefined, "Expected init message", 1003);
            return;
          }
          const envelope = parseJson(data);
          if (!envelope) {
            fail(ws, undefined, "Invalid JSON in init message", 1003);
            return;
          }
          if (envelope.type !== "init") {
            fail(ws, undefined, "First message must be of type 'init'", 1003);
            return;
          }

          // Registered before the first await, so a close or a second frame meanwhile is
          // seen, and what open claims is given back instead of being left behind.
          const pending: PendingInit = { stage: "awaiting-init", gone: false };
          sessions.set(ws, pending);

          const opened = await target.open(envelope, { c, ip });
          if (isRefusal(opened)) {
            sessions.delete(ws);
            fail(ws, undefined, opened.error, opened.code, opened.status);
            return;
          }
          if (pending.gone) {
            target.abandon?.(opened.meta);
            opened.quotaReservation?.release();
            return;
          }

          const id = randomUUID();
          try {
            await storage.createEmpty(id);
          } catch (err) {
            console.error("[upload-ws] Storage init failed:", describeError(err));
            target.abandon?.(opened.meta);
            opened.quotaReservation?.release();
            sessions.delete(ws);
            fail(ws, undefined, "Storage init failed");
            return;
          }
          if (pending.gone) {
            target.abandon?.(opened.meta);
            opened.quotaReservation?.release();
            await storage.abortChunkedUpload(id).catch(() => {});
            return;
          }

          session = {
            id,
            stage: "receiving",
            meta: opened.meta,
            contentLength: opened.contentLength,
            quotaReservation: opened.quotaReservation,
            bytesReceived: 0,
            firstFrameAt: 0,
            buffer: [],
            bufferSize: 0,
            pendingWriteSize: 0,
            writePromise: Promise.resolve(),
            backpressureError: null,
            paused: false,
            clientGone: false,
            windowStart: Date.now(),
            windowBytes: 0,
            progressTimer: null,
            flushTimer: null,
          };
          const started = session;
          started.progressTimer = setInterval(() => {
            if (started.stage === "closed") {
              stopTimers(started);
              return;
            }
            if (started.stage !== "receiving") return;
            const now = Date.now();
            if (now - started.windowStart < PROGRESS_WINDOW_MS) return;
            const remaining = started.contentLength - started.windowBytes;
            const needed = Math.max(1, Math.min(MIN_PROGRESS_BYTES, remaining));
            if (started.bytesReceived - started.windowBytes < needed) {
              fail(ws, started, "Upload timed out", 1008);
              return;
            }
            started.windowStart = now;
            started.windowBytes = started.bytesReceived;
          }, 60_000);
          started.progressTimer.unref?.();
          sessions.set(ws, session);
          sendJson(ws, { type: "ready", id });
          sendJson(ws, {
            type: "storage",
            backend: storage.supportsPresignedUrls() ? "s3" : "filesystem",
          });
          return;
        }

        // ── After init ──────────────────────────────────
        if (session.stage === "closed") return;

        if (typeof data === "string") {
          // Finalize message
          const envelope = parseJson(data);
          if (!envelope) {
            fail(ws, session, "Invalid JSON after init", 1003);
            return;
          }
          if (envelope.type !== "finalize") {
            fail(ws, session, "Unexpected control message", 1003);
            return;
          }
          if (session.stage !== "receiving") {
            fail(ws, session, "Finalize already in progress", 1002);
            return;
          }
          session.stage = "finalizing";
          if (session.flushTimer) clearTimeout(session.flushTimer);
          session.flushTimer = null;

          // Send periodic keepalive messages while finalizing to prevent
          // reverse proxies (Caddy, Nginx) from closing the WebSocket due
          // to inactivity.  Clients silently ignore unknown message types.
          const keepaliveTimer = setInterval(() => {
            if (session!.stage === "finalizing") {
              sendJson(ws, { type: "keepalive" });
            }
          }, 5_000);

          try {
            // Wait for all pending writes to complete, then flush remainder.
            await session.writePromise;
            if (session.backpressureError) throw session.backpressureError;

            // Flush any remaining buffered data.
            if (session.bufferSize > 0) {
              const remaining = session.buffer;
              const remainingSize = session.bufferSize;
              session.buffer = [];
              session.bufferSize = 0;
              session.pendingWriteSize += remainingSize;
              await flushChunks(session, remaining, remainingSize);
            }

            if (session.bytesReceived !== session.contentLength) {
              clearInterval(keepaliveTimer);
              await storage.abortChunkedUpload(session.id).catch(() => {});
              fail(ws, session, "Body size does not match declared content length", 1008);
              return;
            }

            // The session may have been ended meanwhile by a stray frame, which aborted it.
            if (stageOf(session) !== "finalizing") {
              clearInterval(keepaliveTimer);
              return;
            }

            await storage.finalizeChunkedUpload(session.id);

            // A client that left before the commit gets nothing stored, so nothing it was
            // given back can be stored as well.
            if (stageOf(session) !== "finalizing" || session.clientGone) {
              clearInterval(keepaliveTimer);
              await storage.delete(session.id).catch(() => {});
              if (stageOf(session) !== "closed") await close(session);
              return;
            }

            // Persist the row.
            let outcome: WsUploadRefusal | { reply?: Record<string, unknown> } | void;
            try {
              outcome = await target.commit(
                { id: session.id, bytesReceived: session.bytesReceived, meta: session.meta },
                envelope,
              );
            } catch (err) {
              console.error("[upload-ws] Storing the upload failed:", describeError(err));
              outcome = { error: "DB insert failed", code: 1011 };
            }
            if (isRefusal(outcome)) {
              clearInterval(keepaliveTimer);
              await storage.delete(session.id).catch(() => {});
              fail(ws, session, outcome.error, outcome.code, outcome.status);
              return;
            }

            // Stored. Nothing after this may delete the file or give the claim back.
            session.stage = "closed";
            stopTimers(session);
            clearInterval(keepaliveTimer);
            try {
              session.quotaReservation?.commit(session.bytesReceived);
            } catch (err) {
              console.error("[upload-ws] Recording the quota failed:", describeError(err));
            }
            sendJson(ws, { ...outcome?.reply, type: "done", id: session.id });
            try {
              ws.close(1000, "done");
            } catch {
              // ignore
            }
          } catch (err) {
            console.error("[upload-ws] Finalize failed:", describeError(err));
            clearInterval(keepaliveTimer);
            fail(ws, session, "Finalize failed");
          }
          clearInterval(keepaliveTimer);
          return;
        }

        // ── Binary frame ────────────────────────────────
        if (session.stage !== "receiving") {
          fail(ws, session, "Binary frame after finalize", 1002);
          return;
        }

        // Normalise to Uint8Array.
        let frame: Uint8Array;
        if (data instanceof ArrayBuffer) {
          frame = new Uint8Array(data);
        } else if (ArrayBuffer.isView(data)) {
          frame = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else if (data instanceof Blob) {
          try {
            frame = new Uint8Array(await data.arrayBuffer());
          } catch {
            fail(ws, session, "Failed to read binary frame");
            return;
          }
        } else {
          fail(ws, session, "Unsupported binary frame type", 1003);
          return;
        }

        if (session.firstFrameAt === 0) {
          session.firstFrameAt = Date.now();
        }

        if (session.bytesReceived + frame.byteLength > session.contentLength) {
          fail(ws, session, "Received more bytes than declared content length", 1008);
          return;
        }

        session.buffer.push(frame);
        session.bufferSize += frame.byteLength;
        session.bytesReceived += frame.byteLength;

        // ── Backpressure ───────────────────────────────
        // The ws library delivers frames regardless of whether our
        // async onMessage handler has resolved.  For slow backends
        // (S3), data arrives far faster than we can write.  We use
        // TCP-level backpressure by pausing the raw socket when
        // memory usage is high and resuming when it drops.
        const totalMemory = session.bufferSize + session.pendingWriteSize;
        const maxBuffer = config.FILE_UPLOAD_WS_MAX_BUFFER;

        // Pause the socket when we've buffered too much.
        if (!session.paused && totalMemory > maxBuffer * 0.75) {
          session.paused = true;
          pauseSocket(ws);
        }

        if (session.bufferSize >= FLUSH_THRESHOLD) {
          flushBuffer(session, ws, maxBuffer);
        } else if (!session.flushTimer && session.bufferSize > 0) {
          // Armed by the first frame of a buffer and never pushed back by later ones.
          const sessionRef = session;
          sessionRef.flushTimer = setTimeout(() => {
            sessionRef.flushTimer = null;
            if (sessionRef.stage === "receiving") flushBuffer(sessionRef, ws, maxBuffer);
          }, FLUSH_DELAY_MS);
          sessionRef.flushTimer.unref?.();
        }

        // Note: Speed limiting for WebSocket uploads is enforced
        // client-side.  Server-side delays in onMessage do not create
        // backpressure because the ws library delivers frames as they
        // arrive regardless of async handler state.  The speed limit
        // value is exposed via /api/config so the client can throttle
        // its send rate.  See uploadViaWebSocket in upload-worker.ts.
      },

      onClose: async (_evt, ws) => {
        const entry = sessions.get(ws);
        sessions.delete(ws);
        if (!entry || entry.stage === "closed") return;
        if (entry.stage === "awaiting-init") {
          entry.gone = true;
          return;
        }
        // Finalize is running and ends the session itself, with a commit or without one.
        if (entry.stage === "finalizing") {
          entry.clientGone = true;
          return;
        }
        await close(entry);
      },

      onError: (_evt, ws) => {
        const entry = sessions.get(ws);
        if (!entry || entry.stage === "closed") return;
        if (entry.stage === "awaiting-init") {
          entry.gone = true;
          return;
        }
        if (entry.stage === "finalizing") {
          entry.clientGone = true;
          return;
        }
        void close(entry);
      },
    };
  });
}
