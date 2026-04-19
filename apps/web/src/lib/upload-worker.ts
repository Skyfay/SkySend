/**
 * Upload Web Worker - handles encryption + upload off the main thread.
 *
 * This keeps the UI responsive during large file uploads by running
 * the entire crypto + network pipeline in a dedicated thread.
 *
 * Architecture (like Mozilla Send):
 *   File.stream() -> Encrypt -> CountingTransform -> fetch(stream, duplex:"half")
 *
 * The stream goes directly into fetch(). Backpressure from the network
 * slows down encryption, so the counting transform reflects real upload
 * progress. Memory usage stays constant (~64 KB buffer) regardless of
 * file size.
 *
 * In dev mode, uploads go directly to the server (bypassing Vite proxy
 * which doesn't support streaming request bodies).
 */
import {
  deriveKeys,
  computeAuthToken,
  computeOwnerToken,
  createEncryptStream,
  encryptMetadata,
  calculateEncryptedSize,
  toBase64url,
  applyPasswordProtection,
  deriveKeyFromPassword,
  randomBytes,
  PASSWORD_SALT_LENGTH,
  type FileMetadata,
  type Argon2idHashFn,
} from "@skysend/crypto";
import { argon2id } from "hash-wasm";
import { streamingZip } from "./zip";

const hashWasmArgon2: Argon2idHashFn = async (
  password: Uint8Array,
  salt: Uint8Array,
  params: { memory: number; iterations: number; parallelism: number; hashLength: number },
): Promise<Uint8Array> => {
  const result = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: params.hashLength,
    outputType: "binary",
  });
  return new Uint8Array(result);
};

// ── Message Types ──────────────────────────────────────

export interface UploadWorkerRequest {
  /** File to upload (single-file mode). */
  file?: File;
  /** Files to zip and upload (multi-file mode). */
  files?: File[];
  /** Master secret (32 bytes). Transferred. */
  secret: ArrayBuffer;
  /** HKDF salt (16 bytes). Transferred. */
  salt: ArrayBuffer;
  /** Max download count. */
  maxDownloads: number;
  /** Expiry in seconds. */
  expireSec: number;
  /** Optional password (empty string = no password). */
  password: string;
  /** File metadata for encrypted meta blob. */
  metadata: FileMetadata;
  /** Number of files in the upload. */
  fileCount: number;
  /** Base URL for API requests (e.g. "http://localhost:3000" in dev). */
  apiBase: string;
}

export type UploadWorkerMessage =
  | { type: "phase"; phase: string }
  | { type: "progress"; loaded: number; total: number }
  | {
      type: "done";
      id: string;
      ownerToken: string;
      effectiveSecret: string;
    }
  | { type: "error"; message: string };

// ── Worker Logic ───────────────────────────────────────

self.onmessage = async (e: MessageEvent<UploadWorkerRequest>) => {
  const msg = e.data;
  const apiBase = msg.apiBase;

  try {
    const secret = new Uint8Array(msg.secret) as Uint8Array<ArrayBuffer>;
    const salt = new Uint8Array(msg.salt) as Uint8Array<ArrayBuffer>;

    // ── Key Derivation ───────────────────────────────
    const keys = await deriveKeys(secret, salt);

    // ── Password Protection ──────────────────────────
    let effectiveSecret: Uint8Array = secret;
    let hasPassword = false;
    let passwordSalt: Uint8Array | undefined;
    let passwordAlgo: "argon2id" | "pbkdf2" | undefined;

    if (msg.password.length > 0) {
      hasPassword = true;
      passwordSalt = randomBytes(PASSWORD_SALT_LENGTH);
      const { key: passwordKey, algorithm } = await deriveKeyFromPassword(
        msg.password,
        passwordSalt,
        hashWasmArgon2,
      );
      passwordAlgo = algorithm;
      effectiveSecret = applyPasswordProtection(secret, passwordKey);
    }

    // ── Prepare Plaintext Stream ─────────────────────
    let plaintextStream: ReadableStream<Uint8Array>;
    let plaintextSize: number;

    if (msg.file) {
      plaintextStream = msg.file.stream();
      plaintextSize = msg.file.size;
    } else if (msg.files && msg.files.length > 0) {
      // Streaming ZIP: read files one at a time, report byte-accurate progress
      post({ type: "phase", phase: "zipping" });
      const zipResult = await streamingZip(msg.files, (bytesRead, totalBytes) => {
        post({ type: "progress", loaded: bytesRead, total: totalBytes });
      });
      plaintextSize = zipResult.totalSize;
      // Stream from the chunks array without concatenating into a single buffer
      // to avoid exceeding the ~2 GB contiguous ArrayBuffer limit.
      let chunkIndex = 0;
      plaintextStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunkIndex >= zipResult.chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(zipResult.chunks[chunkIndex]!);
          chunkIndex++;
        },
      });
    } else {
      throw new Error("No file or zip data provided");
    }

    // ── Encrypt + Upload ───────────────────────────────
    // Pre-flight: verify server is reachable before starting
    let maxConcurrentUploads = 3; // fallback default
    let wsEnabled = false;
    let speedLimit = 0; // bytes/sec, 0 = unlimited
    try {
      const healthRes = await fetch(`${apiBase}/api/config`);
      if (!healthRes.ok) {
        throw new Error(`Server responded with ${healthRes.status}`);
      }
      const serverConfig = await healthRes.json() as {
        fileUploadConcurrentChunks?: number;
        fileUploadWs?: boolean;
        fileUploadSpeedLimit?: number;
      };
      if (typeof serverConfig.fileUploadConcurrentChunks === "number" && serverConfig.fileUploadConcurrentChunks > 0) {
        maxConcurrentUploads = serverConfig.fileUploadConcurrentChunks;
      }
      wsEnabled = serverConfig.fileUploadWs === true;
      if (typeof serverConfig.fileUploadSpeedLimit === "number" && serverConfig.fileUploadSpeedLimit > 0) {
        speedLimit = serverConfig.fileUploadSpeedLimit;
      }
    } catch (e) {
      throw new Error(
        `Server unreachable at ${apiBase || "(same-origin)"}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    post({ type: "phase", phase: "uploading" });

    const encryptedSize = calculateEncryptedSize(plaintextSize);

    // Compute auth tokens
    const authToken = await computeAuthToken(keys.authKey);
    const ownerToken = await computeOwnerToken(effectiveSecret, salt);
    const ownerTokenB64 = toBase64url(ownerToken);

    // Build upload headers
    const headers: Record<string, string> = {
      "X-Auth-Token": toBase64url(authToken),
      "X-Owner-Token": ownerTokenB64,
      "X-Salt": toBase64url(salt),
      "X-Max-Downloads": String(msg.maxDownloads),
      "X-Expire-Sec": String(msg.expireSec),
      "X-File-Count": String(msg.fileCount),
      "X-Has-Password": String(hasPassword),
      "X-Content-Length": String(encryptedSize),
    };

    if (hasPassword && passwordSalt && passwordAlgo) {
      headers["X-Password-Salt"] = toBase64url(passwordSalt);
      headers["X-Password-Algo"] = passwordAlgo;
    }

    // Encrypt the entire file into chunks, collecting into a Blob.
    // We pipe through createEncryptStream but collect the output.
    // To avoid OOM for very large files, we use a chunked upload approach:
    // encrypt and upload in CHUNK_UPLOAD_SIZE pieces via parallel requests.
    // Chrome/Brave serialize large HTTP/2 POST bodies through reverse proxies,
    // so we use smaller chunks (10 MB) with server-configurable concurrent uploads.
    const CHUNK_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB per request
    const encryptedStream = plaintextStream.pipeThrough(
      createEncryptStream(keys.fileKey),
    );

    // Pre-flight the WebSocket transport.  If the handshake succeeds, the
    // entire encrypted stream is consumed via WS.  If the handshake fails
    // (server disabled WS, proxy blocks upgrade, handshake timeout), we
    // fall back to the HTTP chunked upload using the same encrypted stream
    // (it has not yet been read).
    let uploadResult: { id: string };
    let wsUsable = false;
    let wsInstance: WebSocket | null = null;
    if (wsEnabled) {
      try {
        wsInstance = await openUploadWebSocket(apiBase);
        wsUsable = true;
      } catch (err) {
        console.warn(
          "[upload-worker] WebSocket handshake failed, falling back to HTTP chunks:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (wsUsable && wsInstance) {
      console.info("[upload-worker] transport=ws");
      uploadResult = await uploadViaWebSocket({
        ws: wsInstance,
        headers: {
          authToken: headers["X-Auth-Token"]!,
          ownerToken: ownerTokenB64,
          salt: headers["X-Salt"]!,
          maxDownloads: msg.maxDownloads,
          expireSec: msg.expireSec,
          fileCount: msg.fileCount,
          contentLength: encryptedSize,
          hasPassword,
          passwordSalt: hasPassword && passwordSalt ? toBase64url(passwordSalt) : undefined,
          passwordAlgo: hasPassword ? passwordAlgo : undefined,
        },
        encryptedStream,
        encryptedSize,
        speedLimit,
        post,
      });
    } else {
      console.info("[upload-worker] transport=http");
      uploadResult = await uploadViaHttpChunks({
        apiBase,
        headers,
        ownerTokenB64,
        encryptedStream,
        encryptedSize,
        maxConcurrentUploads,
        chunkSize: CHUNK_UPLOAD_SIZE,
        post,
      });
    }

    // ── Save Encrypted Metadata ──────────────────────
    post({ type: "phase", phase: "saving-meta" });

    const encMeta = await encryptMetadata(msg.metadata, keys.metaKey);
    const encryptedMeta = btoa(
      String.fromCharCode(...encMeta.ciphertext),
    );
    const nonce = btoa(String.fromCharCode(...encMeta.iv));

    const metaRes = await fetch(
      `${apiBase}/api/meta/${encodeURIComponent(uploadResult.id)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Token": ownerTokenB64,
        },
        body: JSON.stringify({ encryptedMeta, nonce }),
      },
    );

    if (!metaRes.ok) {
      throw new Error("Failed to save metadata");
    }

    // ── Done ─────────────────────────────────────────
    post({
      type: "done",
      id: uploadResult.id,
      ownerToken: ownerTokenB64,
      effectiveSecret: toBase64url(effectiveSecret),
    });
  } catch (err) {
    console.error("[upload-worker] Upload failed:", err);
    post({
      type: "error",
      message: err instanceof Error ? err.message : "Upload failed",
    });
  }
};

function post(msg: UploadWorkerMessage) {
  self.postMessage(msg);
}

// ── HTTP Chunked Upload (fallback transport) ──────────

interface HttpUploadOpts {
  apiBase: string;
  headers: Record<string, string>;
  ownerTokenB64: string;
  encryptedStream: ReadableStream<Uint8Array>;
  encryptedSize: number;
  maxConcurrentUploads: number;
  chunkSize: number;
  post: (m: UploadWorkerMessage) => void;
}

async function uploadViaHttpChunks(opts: HttpUploadOpts): Promise<{ id: string }> {
  const {
    apiBase,
    headers,
    ownerTokenB64,
    encryptedStream,
    encryptedSize,
    maxConcurrentUploads,
    chunkSize: CHUNK_UPLOAD_SIZE,
    post,
  } = opts;

  const reader = encryptedStream.getReader();

  const initRes = await fetch(`${apiBase}/api/upload/init`, {
    method: "POST",
    headers,
  });
  if (!initRes.ok) {
    const data = await initRes.json().catch(() => ({ error: "Upload init failed" }));
    throw new Error((data as { error?: string }).error ?? "Upload init failed");
  }
  const { id: uploadId } = (await initRes.json()) as { id: string };

  let loaded = 0;
  let chunkParts: Uint8Array[] = [];
  let chunkSize = 0;
  let chunkIndex = 0;
  let uploadError: Error | null = null;
  const active: Array<Promise<void>> = [];

  const uploadChunk = async (data: Blob, index: number) => {
    const res = await fetch(
      `${apiBase}/api/upload/${encodeURIComponent(uploadId)}/chunk?index=${index}`,
      { method: "POST", body: data },
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: "Chunk upload failed" }));
      throw new Error((errData as { error?: string }).error ?? "Chunk upload failed");
    }
    // Consume response body - important for Chrome to release the HTTP/2 stream.
    await res.json();
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunkParts.push(value);
    chunkSize += value.byteLength;

    if (chunkSize >= CHUNK_UPLOAD_SIZE) {
      const blob = new Blob(chunkParts as unknown as BlobPart[]);
      chunkParts = [];
      const uploadedChunkSize = chunkSize;
      chunkSize = 0;
      const currentIndex = chunkIndex++;

      const p = uploadChunk(blob, currentIndex).then(() => {
        loaded += uploadedChunkSize;
        post({ type: "progress", loaded, total: encryptedSize });
      });
      const tracked = p.catch((err) => {
        uploadError = err instanceof Error ? err : new Error(String(err));
      }).finally(() => {
        const idx = active.indexOf(tracked);
        if (idx !== -1) active.splice(idx, 1);
      });
      active.push(tracked);

      if (active.length >= maxConcurrentUploads) {
        await Promise.race(active);
      }
      if (uploadError) throw uploadError;
    }
  }

  if (chunkSize > 0) {
    const blob = new Blob(chunkParts as unknown as BlobPart[]);
    const uploadedChunkSize = chunkSize;
    chunkParts = [];
    chunkSize = 0;
    const currentIndex = chunkIndex++;

    const p = uploadChunk(blob, currentIndex).then(() => {
      loaded += uploadedChunkSize;
      post({ type: "progress", loaded, total: encryptedSize });
    });
    const tracked = p.catch((err) => {
      uploadError = err instanceof Error ? err : new Error(String(err));
    }).finally(() => {
      const idx = active.indexOf(tracked);
      if (idx !== -1) active.splice(idx, 1);
    });
    active.push(tracked);
  }

  await Promise.all(active);
  if (uploadError) throw uploadError;

  const finalizeRes = await fetch(
    `${apiBase}/api/upload/${encodeURIComponent(uploadId)}/finalize`,
    {
      method: "POST",
      headers: { "X-Owner-Token": ownerTokenB64 },
    },
  );
  if (!finalizeRes.ok) {
    const data = await finalizeRes.json().catch(() => ({ error: "Upload finalize failed" }));
    throw new Error((data as { error?: string }).error ?? "Upload finalize failed");
  }

  return { id: uploadId };
}

// ── WebSocket Upload (primary transport) ──────────────

interface WsInitHeaders {
  authToken: string;
  ownerToken: string;
  salt: string;
  maxDownloads: number;
  expireSec: number;
  fileCount: number;
  contentLength: number;
  hasPassword: boolean;
  passwordSalt?: string;
  passwordAlgo?: "argon2id" | "pbkdf2";
}

/**
 * Open a WebSocket to the upload endpoint.  Resolves on `open` within
 * WS_HANDSHAKE_TIMEOUT_MS, rejects otherwise.  A rejection here is safe
 * to retry via HTTP chunks because no data has been consumed from the
 * encrypted stream yet.
 */
function openUploadWebSocket(apiBase: string): Promise<WebSocket> {
  const WS_HANDSHAKE_TIMEOUT_MS = 10_000;
  return new Promise<WebSocket>((resolve, reject) => {
    let url: URL;
    try {
      const base = apiBase && apiBase.length > 0 ? apiBase : self.location.origin;
      url = new URL("/api/upload/ws", base);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Invalid apiBase for WS"));
      return;
    }

    let settled = false;
    const ws = new WebSocket(url.toString());
    ws.binaryType = "arraybuffer";

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error("WebSocket handshake timed out"));
    }, WS_HANDSHAKE_TIMEOUT_MS);

    ws.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("WebSocket handshake failed"));
    });
    ws.addEventListener("close", (evt) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`WebSocket closed during handshake (code=${evt.code})`));
    });
  });
}

interface WsUploadOpts {
  ws: WebSocket;
  headers: WsInitHeaders;
  encryptedStream: ReadableStream<Uint8Array>;
  encryptedSize: number;
  /** Server-configured speed limit in bytes/sec.  0 = unlimited. */
  speedLimit: number;
  post: (m: UploadWorkerMessage) => void;
}

async function uploadViaWebSocket(opts: WsUploadOpts): Promise<{ id: string }> {
  const { ws, headers, encryptedStream, encryptedSize, speedLimit, post } = opts;

  const FRAME_SIZE = 256 * 1024; // 256 KB per WebSocket frame
  const HIGH_WATER = 8 * 1024 * 1024; // pause sending above this
  const LOW_WATER = 2 * 1024 * 1024;
  const READY_TIMEOUT_MS = 10_000;
  const DONE_TIMEOUT_MS = 5 * 60_000;

  let fatalError: Error | null = null;
  let doneId: string | null = null;
  let readyId: string | null = null;
  const readyWaiters: Array<() => void> = [];
  const doneWaiters: Array<() => void> = [];

  const notifyReady = () => { for (const f of readyWaiters.splice(0)) f(); };
  const notifyDone = () => { for (const f of doneWaiters.splice(0)) f(); };

  ws.addEventListener("message", (evt) => {
    if (typeof evt.data !== "string") return;
    let msg: { type?: string; id?: string; message?: string };
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }
    if (msg.type === "ready" && typeof msg.id === "string") {
      readyId = msg.id;
      notifyReady();
    } else if (msg.type === "done" && typeof msg.id === "string") {
      doneId = msg.id;
      notifyReady();
      notifyDone();
    } else if (msg.type === "error") {
      fatalError = new Error(msg.message ?? "Server error");
      notifyReady();
      notifyDone();
    }
  });

  ws.addEventListener("close", (evt) => {
    if (!doneId && !fatalError) {
      fatalError = new Error(
        `WebSocket closed unexpectedly (code=${evt.code}${evt.reason ? `, reason=${evt.reason}` : ""})`,
      );
    }
    notifyReady();
    notifyDone();
  });
  ws.addEventListener("error", () => {
    if (!fatalError) fatalError = new Error("WebSocket error");
    notifyReady();
    notifyDone();
  });

  try {
    // Send init message.
    ws.send(JSON.stringify({ type: "init", headers }));

    // Wait for ready.
    await new Promise<void>((resolve, reject) => {
      if (readyId || fatalError) { resolve(); return; }
      const timer = setTimeout(() => {
        reject(new Error("WebSocket ready timed out"));
      }, READY_TIMEOUT_MS);
      readyWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
    if (fatalError) throw fatalError;
    if (!readyId) throw new Error("Server did not return an upload id");

    // Stream encrypted data in small frames with backpressure.
    const reader = encryptedStream.getReader();
    let loaded = 0;
    let carry: Uint8Array | null = null;
    const sendStartedAt = Date.now();

    const drain = async () => {
      while (ws.bufferedAmount > LOW_WATER) {
        if (fatalError) throw fatalError;
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    const sendFrame = async (frame: Uint8Array) => {
      if (fatalError) throw fatalError;
      if (ws.bufferedAmount > HIGH_WATER) await drain();

      // Speed limit: pause if sending faster than the server allows.
      if (speedLimit > 0 && loaded > 0) {
        const elapsedMs = Date.now() - sendStartedAt;
        const expectedMs = (loaded / speedLimit) * 1000;
        const delayMs = expectedMs - elapsedMs;
        if (delayMs > 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      // Copy into a fresh ArrayBuffer to satisfy strict BufferSource typing
      // (the source may be a view over a SharedArrayBuffer-typed buffer).
      const frameCopy = new Uint8Array(frame.byteLength);
      frameCopy.set(frame);
      ws.send(frameCopy.buffer);
      loaded += frame.byteLength;
      post({ type: "progress", loaded, total: encryptedSize });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      let buf: Uint8Array;
      if (carry && carry.byteLength > 0) {
        buf = new Uint8Array(carry.byteLength + value.byteLength);
        buf.set(carry);
        buf.set(value, carry.byteLength);
        carry = null;
      } else {
        buf = value;
      }

      let offset = 0;
      while (buf.byteLength - offset >= FRAME_SIZE) {
        await sendFrame(buf.subarray(offset, offset + FRAME_SIZE));
        offset += FRAME_SIZE;
      }
      if (offset < buf.byteLength) {
        carry = buf.slice(offset);
      }
    }
    if (carry && carry.byteLength > 0) {
      await sendFrame(carry);
      carry = null;
    }

    if (fatalError) throw fatalError;

    // Send finalize and wait for done.
    ws.send(JSON.stringify({ type: "finalize" }));
    await new Promise<void>((resolve, reject) => {
      if (doneId || fatalError) { resolve(); return; }
      const timer = setTimeout(() => {
        reject(new Error("WebSocket finalize timed out"));
      }, DONE_TIMEOUT_MS);
      doneWaiters.push(() => { clearTimeout(timer); resolve(); });
    });

    if (fatalError) throw fatalError;
    if (!doneId) throw new Error("Server did not confirm upload completion");
    return { id: doneId };
  } finally {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try { ws.close(); } catch { /* ignore */ }
    }
  }
}
