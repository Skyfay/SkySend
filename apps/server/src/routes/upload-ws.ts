import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { fromBase64url } from "@skysend/crypto";
import type { StorageBackend } from "../storage/types.js";
import {
  uploadHeadersSchema,
  validateUploadHeaders,
  type UploadHeaders,
} from "../lib/upload-validation.js";
import { getClientIp } from "../middleware/rate-limit.js";

/**
 * WebSocket upload transport.
 *
 * Protocol:
 *   1. Client connects to /api/upload/ws.
 *   2. Client sends a JSON text frame:
 *      {"type":"init", headers: { authToken, ownerToken, salt, maxDownloads,
 *        expireSec, fileCount, contentLength, hasPassword,
 *        passwordSalt?, passwordAlgo? }}
 *   3. Server validates (identical to the HTTP upload route), creates an
 *      empty storage entry and replies: {"type":"ready", id}
 *   4. Client sends contiguous binary frames containing ciphertext.
 *      WebSocket preserves ordering so no per-frame index is needed.
 *   5. Client sends a JSON text frame: {"type":"finalize"}
 *   6. Server verifies bytesWritten === contentLength, finalizes storage,
 *      inserts the DB row, records quota, replies {"type":"done", id}
 *      and closes with code 1000.
 *
 * Errors close the socket with code 1011 and an {"type":"error", message}
 * frame. Abnormal closes before finalize abort the storage entry.
 */

type QuotaRecorder = (hashedIp: string, bytes: number) => void;
interface QuotaAdapter {
  /** If non-null, upload must not proceed. Returns rejection reason. */
  check(ip: string, contentLength: number): { ok: true; hashedIp: string | null } | { ok: false; reason: string };
  record: QuotaRecorder;
}

type Stage = "awaiting-init" | "receiving" | "finalizing" | "closed";

interface Session {
  id: string;
  stage: Stage;
  headers: UploadHeaders;
  quotaHashedIp: string | null;
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
}

export interface UploadWsRouteDeps {
  storage: StorageBackend;
  upgradeWebSocket: UpgradeWebSocket;
  quota: QuotaAdapter;
}

export function createUploadWsRoute(deps: UploadWsRouteDeps) {
  const { storage, upgradeWebSocket, quota } = deps;
  const route = new Hono();

  /** Threshold above which buffered frames are flushed to storage. */
  const FLUSH_THRESHOLD = 4 * 1024 * 1024; // 4 MB

  const sessions = new WeakMap<WSContext, Session>();

  /**
   * Flush pre-detached chunks to storage.
   * The caller must detach the buffer synchronously and pass the chunks here
   * so that new frames accumulate into a fresh buffer while this write is
   * in-flight.  This is critical for slow backends (S3) where appendChunk
   * involves network I/O.
   */
  async function flushChunks(
    session: Session,
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
    } catch { /* not all adapters support this */ }
  }

  /** Resume a previously paused socket. */
  function resumeSocket(ws: WSContext): void {
    try {
      const raw = ws.raw as { resume?: () => void } | undefined;
      raw?.resume?.();
    } catch { /* ignore */ }
  }

  function sendJson(ws: WSContext, payload: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Socket already closed - ignore.
    }
  }

  function fail(ws: WSContext, session: Session | undefined, message: string, code = 1011): void {
    sendJson(ws, { type: "error", message });
    if (session && session.stage !== "closed") {
      session.stage = "closed";
      // Resume socket if paused so the close frame can be sent.
      if (session.paused) {
        session.paused = false;
        resumeSocket(ws);
      }
      storage.abortChunkedUpload(session.id).catch(() => {});
    }
    try {
      ws.close(code, message.slice(0, 120));
    } catch {
      // ignore
    }
  }

  route.get(
    "/",
    upgradeWebSocket((c) => {
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
            try { ws.close(1008, "Origin not allowed"); } catch { /* ignore */ }
          }
        },

        onMessage: async (evt, ws) => {
          if (!originAllowed) return;
          const data = evt.data;
          let session = sessions.get(ws);

          // ── Init message (text JSON) ────────────────────
          if (!session) {
            if (typeof data !== "string") {
              fail(ws, undefined, "Expected init message", 1003);
              return;
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              fail(ws, undefined, "Invalid JSON in init message", 1003);
              return;
            }
            const envelope = parsed as { type?: string; headers?: Record<string, unknown> };
            if (envelope.type !== "init" || !envelope.headers) {
              fail(ws, undefined, "First message must be of type 'init'", 1003);
              return;
            }

            // Coerce header values to strings for the shared schema.
            const headerInput: Record<string, string | undefined> = {};
            for (const [k, v] of Object.entries(envelope.headers)) {
              if (v === undefined || v === null) continue;
              headerInput[k] = typeof v === "string" ? v : String(v);
            }

            const headerResult = uploadHeadersSchema.safeParse(headerInput);
            if (!headerResult.success) {
              fail(ws, undefined, "Invalid upload headers", 1008);
              return;
            }
            const headers = headerResult.data;

            const validationError = validateUploadHeaders(headers, config);
            if (validationError) {
              fail(ws, undefined, validationError.message, 1008);
              return;
            }

            // Quota
            const quotaResult = quota.check(ip, headers.contentLength);
            if (!quotaResult.ok) {
              fail(ws, undefined, quotaResult.reason, 1008);
              return;
            }

            const id = randomUUID();
            try {
              await storage.createEmpty(id);
            } catch (err) {
              fail(ws, undefined, err instanceof Error ? err.message : "Storage init failed");
              return;
            }

            session = {
              id,
              stage: "receiving",
              headers,
              quotaHashedIp: quotaResult.hashedIp,
              bytesReceived: 0,
              firstFrameAt: 0,
              buffer: [],
              bufferSize: 0,
              pendingWriteSize: 0,
              writePromise: Promise.resolve(),
              backpressureError: null,
              paused: false,
            };
            sessions.set(ws, session);
            sendJson(ws, { type: "ready", id });
            return;
          }

          // ── After init ──────────────────────────────────
          if (session.stage === "closed") return;

          if (typeof data === "string") {
            // Finalize message
            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              fail(ws, session, "Invalid JSON after init", 1003);
              return;
            }
            const envelope = parsed as { type?: string };
            if (envelope.type !== "finalize") {
              fail(ws, session, "Unexpected control message", 1003);
              return;
            }
            if (session.stage !== "receiving") {
              fail(ws, session, "Finalize already in progress", 1002);
              return;
            }
            session.stage = "finalizing";

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

              if (session.bytesReceived !== session.headers.contentLength) {
                await storage.abortChunkedUpload(session.id).catch(() => {});
                fail(ws, session, "Body size does not match declared content length", 1008);
                return;
              }

              await storage.finalizeChunkedUpload(session.id);

              // Persist DB row.
              const { headers } = session;
              let passwordSaltBuffer: Buffer | null = null;
              if (headers.hasPassword && headers.passwordSalt) {
                passwordSaltBuffer = Buffer.from(fromBase64url(headers.passwordSalt));
              }
              const now = new Date();
              const expiresAt = new Date(now.getTime() + headers.expireSec * 1000);
              const storagePath = `${session.id}.bin`;

              const db = getDb();
              try {
                db.insert(uploads).values({
                  id: session.id,
                  ownerToken: headers.ownerToken,
                  authToken: headers.authToken,
                  salt: Buffer.from(fromBase64url(headers.salt)),
                  size: session.bytesReceived,
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
                await storage.delete(session.id).catch(() => {});
                fail(ws, session, err instanceof Error ? err.message : "DB insert failed");
                return;
              }

              if (session.quotaHashedIp) {
                quota.record(session.quotaHashedIp, session.bytesReceived);
              }

              session.stage = "closed";
              sendJson(ws, { type: "done", id: session.id });
              try {
                ws.close(1000, "done");
              } catch {
                // ignore
              }
            } catch (err) {
              fail(ws, session, err instanceof Error ? err.message : "Finalize failed");
            }
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
            frame = new Uint8Array(
              data.buffer,
              data.byteOffset,
              data.byteLength,
            );
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

          if (session.bytesReceived + frame.byteLength > session.headers.contentLength) {
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
            // Detach the buffer synchronously so new frames accumulate
            // into a fresh array while the (potentially slow) storage
            // write is in flight.  This is critical for S3 backends
            // where appendChunk involves network I/O.
            const chunksToFlush = session.buffer;
            const sizeToFlush = session.bufferSize;
            session.buffer = [];
            session.bufferSize = 0;
            session.pendingWriteSize += sizeToFlush;

            const sessionRef = session;
            const wsRef = ws;
            const resumeThreshold = maxBuffer * 0.5;
            sessionRef.writePromise = sessionRef.writePromise
              .then(() => flushChunks(sessionRef, chunksToFlush, sizeToFlush))
              .then(() => {
                // Resume socket once memory pressure has eased.
                if (sessionRef.paused) {
                  const current = sessionRef.bufferSize + sessionRef.pendingWriteSize;
                  if (current < resumeThreshold) {
                    sessionRef.paused = false;
                    resumeSocket(wsRef);
                  }
                }
              })
              .catch((err) => {
                // Store the error for the finalize handler to detect.
                // Do NOT re-throw: that would create an unhandled rejection
                // and crash Node.js when the writePromise chain continues
                // after an abort.
                if (sessionRef.stage !== "closed") {
                  sessionRef.backpressureError =
                    err instanceof Error ? err : new Error(String(err));
                }
              });
          }

          // Note: Speed limiting for WebSocket uploads is enforced
          // client-side.  Server-side delays in onMessage do not create
          // backpressure because the ws library delivers frames as they
          // arrive regardless of async handler state.  The speed limit
          // value is exposed via /api/config so the client can throttle
          // its send rate.  See uploadViaWebSocket in upload-worker.ts.
        },

        onClose: async (_evt, ws) => {
          const session = sessions.get(ws);
          sessions.delete(ws);
          if (!session) return;
          if (session.stage === "closed") return;
          session.stage = "closed";
          await storage.abortChunkedUpload(session.id).catch(() => {});
        },

        onError: (_evt, ws) => {
          const session = sessions.get(ws);
          if (!session || session.stage === "closed") return;
          session.stage = "closed";
          storage.abortChunkedUpload(session.id).catch(() => {});
        },
      };
    }),
  );

  return route;
}
