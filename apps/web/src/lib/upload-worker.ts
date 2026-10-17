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
  expectedBaseNonce,
  NONCE_LENGTH,
  calculateEncryptedSize,
  toBase64url,
  applyPasswordProtection,
  deriveKeyFromPassword,
  randomBytes,
  wrapFileSecret,
  PASSWORD_SALT_LENGTH,
  type RequestUploadMetadata,
  type Argon2idHashFn,
} from "@skysend/crypto";
import { argon2id } from "hash-wasm";
import { z } from "zod";
import { zipSize, zipStream } from "./zip";

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

/**
 * Chrome and Brave serialize large HTTP/2 POST bodies through reverse proxies, so the
 * chunked transport sends 10 MB per request, with server-configurable parallel requests.
 */
const CHUNK_UPLOAD_SIZE = 10 * 1024 * 1024;

/** Upload IDs come from randomUUID() on the server, and the wrap binds this one. */
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The token of a slot the server holds for the second part of a submission. */
const SLOT_HOLD = /^[A-Za-z0-9_-]{22}$/;

const holdAnswer = z.object({ hold: z.string().regex(SLOT_HOLD) });

/** The held slot a finalize answer hands over, if it is a well-formed one. */
function holdOf(answer: unknown): string | undefined {
  const parsed = holdAnswer.safeParse(answer);
  return parsed.success ? parsed.data.hold : undefined;
}

// ── Message Types ──────────────────────────────────────

export interface UploadWorkerRequest {
  /** File to upload (single-file mode). */
  file?: File;
  /** Files to zip and upload (multi-file mode), named in the zip as `metadata` lists them. */
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
  metadata: RequestUploadMetadata;
  /** Number of files in the upload. */
  fileCount: number;
  /** Base URL for API requests (e.g. "http://localhost:3000" in dev). */
  apiBase: string;
  /**
   * Upload into a file request. The file secret is wrapped to `publicKey`, which comes from
   * the upload link, and travels with the metadata at finalize. Same transports as a
   * normal upload: WebSocket first, chunked HTTP as the fallback.
   */
  request?: {
    id: string;
    uploadToken: string;
    publicKey: ArrayBuffer;
    /** The first part of a submission, which reserves the slot of its second part too. */
    reserveNext?: boolean;
    /** The slot the first part of a submission held for this one. */
    hold?: string;
  };
}

export type UploadWorkerMessage =
  | { type: "phase"; phase: string }
  | { type: "progress"; loaded: number; total: number }
  | { type: "transport"; transport: "ws" | "http"; fallback: boolean }
  | { type: "storage"; backend: "s3" | "filesystem" }
  | {
      type: "done";
      id: string;
      ownerToken: string;
      effectiveSecret: string;
    }
  /** An upload into a file request opened its session, so a cancel can end it. */
  | { type: "session"; id: string }
  /**
   * An upload into a file request arrived. The sender gets nothing back to share, only the
   * slot held for the next part of its submission.
   */
  | { type: "delivered"; id: string; hold?: string }
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
    let passwordAlgo: "argon2id" | "argon2id-v2" | "pbkdf2" | undefined;

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
    } else if (msg.files && msg.files.length > 0 && msg.metadata.type === "archive") {
      // The zip is written while the upload reads it, under the names the metadata lists, so
      // the recipient gets exactly the paths they are shown. WebKit drops webkitRelativePath
      // when it posts a File to a worker, the metadata built on the page keeps it.
      const names = msg.metadata.files.map((file) => file.name);
      if (names.length !== msg.files.length) throw new Error("The file list does not match");
      const entries = msg.files.map((file, i) => ({
        name: names[i]!,
        size: file.size,
        stream: () => file.stream(),
      }));
      plaintextSize = zipSize(entries);
      plaintextStream = zipStream(entries);
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
        { cause: e },
      );
    }

    post({ type: "phase", phase: "uploading" });

    const encryptedSize = calculateEncryptedSize(plaintextSize);

    // The recipient needs the archive size to tell a complete download from one the server
    // cut short. The page put the same number into the metadata for its size check.
    // The stream is encrypted with the base nonce the metadata names, so the recipient can
    // check the header against it. The page puts one in, a metadata without one gets one here.
    const withSize: RequestUploadMetadata =
      msg.metadata.type === "archive"
        ? { ...msg.metadata, archiveSize: plaintextSize }
        : msg.metadata;
    const metadata: RequestUploadMetadata = withSize.streamNonce
      ? withSize
      : { ...withSize, streamNonce: toBase64url(randomBytes(NONCE_LENGTH)) };
    const baseNonce = expectedBaseNonce(metadata);

    if (msg.request) {
      const delivered = await uploadIntoRequest({
        apiBase,
        request: msg.request,
        secret,
        salt,
        metadata,
        metaKey: keys.metaKey,
        fileCount: msg.fileCount,
        encryptedStream: plaintextStream.pipeThrough(createEncryptStream(keys.fileKey, baseNonce)),
        encryptedSize,
        maxConcurrentUploads,
        wsEnabled,
        speedLimit,
        post,
      });
      post({ type: "delivered", ...delivered });
      return;
    }

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
    const encryptedStream = plaintextStream.pipeThrough(
      createEncryptStream(keys.fileKey, baseNonce),
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
      post({ type: "transport", transport: "ws", fallback: false });
      uploadResult = await uploadViaWebSocket({
        ws: wsInstance,
        init: {
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
          } satisfies WsInitHeaders,
        },
        encryptedStream,
        encryptedSize,
        speedLimit,
        post,
      });
    } else {
      console.info("[upload-worker] transport=http");
      post({ type: "transport", transport: "http", fallback: wsEnabled && !wsUsable });
      uploadResult = await uploadViaHttpChunks({
        paths: {
          init: `${apiBase}/api/upload/init`,
          chunk: (id, index) =>
            `${apiBase}/api/upload/${encodeURIComponent(id)}/chunk?index=${index}`,
          finalize: (id) => `${apiBase}/api/upload/${encodeURIComponent(id)}/finalize`,
        },
        headers,
        finalizeRequest: async () => ({
          method: "POST",
          headers: { "X-Owner-Token": ownerTokenB64 },
        }),
        encryptedStream,
        encryptedSize,
        maxConcurrentUploads,
        chunkSize: CHUNK_UPLOAD_SIZE,
        post,
      });
    }

    // ── Save Encrypted Metadata ──────────────────────
    post({ type: "phase", phase: "saving-meta" });

    const encMeta = await encryptMetadata(metadata, keys.metaKey);
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
  /** The init endpoint, its chunks and its finalize, as full URLs. */
  paths: {
    init: string;
    chunk: (uploadId: string, index: number) => string;
    finalize: (uploadId: string) => string;
  };
  headers: Record<string, string>;
  /** The finalize request, which may need the upload ID. */
  finalizeRequest: (uploadId: string) => Promise<RequestInit>;
  /** Turns a failed init or finalize into the message the page shows. */
  httpError?: (status: number, message: string) => string;
  /** Called with the upload ID once the session is open. */
  onSession?: (uploadId: string) => void;
  encryptedStream: ReadableStream<Uint8Array>;
  encryptedSize: number;
  maxConcurrentUploads: number;
  chunkSize: number;
  post: (m: UploadWorkerMessage) => void;
}

async function uploadViaHttpChunks(opts: HttpUploadOpts): Promise<{ id: string; hold?: string }> {
  const {
    paths,
    headers,
    finalizeRequest,
    httpError,
    onSession,
    encryptedStream,
    encryptedSize,
    maxConcurrentUploads,
    chunkSize: CHUNK_UPLOAD_SIZE,
    post,
  } = opts;

  const reader = encryptedStream.getReader();

  const initRes = await fetch(paths.init, {
    method: "POST",
    headers,
  });
  if (!initRes.ok) {
    const data = await initRes.json().catch(() => ({ error: "Upload init failed" }));
    const message = (data as { error?: string }).error ?? "Upload init failed";
    throw new Error(httpError ? httpError(initRes.status, message) : message);
  }
  const { id: uploadId } = (await initRes.json()) as { id?: unknown };
  if (typeof uploadId !== "string" || !UPLOAD_ID.test(uploadId)) {
    throw new Error("Upload init failed");
  }
  onSession?.(uploadId);

  let loaded = 0;
  let chunkParts: Uint8Array[] = [];
  let chunkSize = 0;
  let chunkIndex = 0;
  let uploadError: Error | null = null;
  const active: Array<Promise<void>> = [];

  const uploadChunk = async (data: Blob, index: number) => {
    const res = await fetch(paths.chunk(uploadId, index), { method: "POST", body: data });
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
    const currentIndex = chunkIndex;

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

  // Every chunk is in, the server may still be writing them to storage, see uploadViaWebSocket.
  post({ type: "phase", phase: "saving-meta" });

  const finalizeRes = await fetch(paths.finalize(uploadId), await finalizeRequest(uploadId));
  if (!finalizeRes.ok) {
    const data = await finalizeRes.json().catch(() => ({ error: "Upload finalize failed" }));
    const message = (data as { error?: string }).error ?? "Upload finalize failed";
    throw new Error(httpError ? httpError(finalizeRes.status, message) : message);
  }
  const hold = holdOf(await finalizeRes.json().catch(() => null));

  return hold ? { id: uploadId, hold } : { id: uploadId };
}

// ── Upload Into a File Request ────────────────────────

interface RequestUploadOpts {
  apiBase: string;
  request: NonNullable<UploadWorkerRequest["request"]>;
  secret: Uint8Array;
  salt: Uint8Array;
  metadata: RequestUploadMetadata;
  metaKey: CryptoKey;
  fileCount: number;
  encryptedStream: ReadableStream<Uint8Array>;
  encryptedSize: number;
  maxConcurrentUploads: number;
  /** Whether the server offers the WebSocket transport (fileUploadWs). */
  wsEnabled: boolean;
  /** Server-configured speed limit in bytes/sec.  0 = unlimited. */
  speedLimit: number;
  post: (m: UploadWorkerMessage) => void;
}

/** Why the server refused to open an upload into a request, as the key the page shows. */
function requestHttpError(status: number, message: string): string {
  // The upload quota of the sender answers with 413 or 429 too, and names itself.
  if ((status === 413 || status === 429) && /quota/i.test(message)) return "quota";
  if (status === 404 || status === 403) return "gone";
  if (status === 409) return "full";
  if (status === 410) return "closed";
  if (status === 413) return "tooLarge";
  return message;
}

/**
 * Uploads into a file request with the same transports as a normal upload: WebSocket when
 * the server offers it, chunked HTTP when it does not or the handshake fails. Init reserves
 * a slot and returns the upload ID, which the wrap of the file secret binds, so the box
 * cannot be moved to another upload or request. Finalize carries the box and the encrypted
 * metadata together.
 */
async function uploadIntoRequest(opts: RequestUploadOpts): Promise<{ id: string; hold?: string }> {
  const { apiBase, request, secret, salt, metadata, metaKey, fileCount, encryptedSize, post } =
    opts;
  const base = `/api/request/${encodeURIComponent(request.id)}/upload`;
  const publicKey = new Uint8Array(request.publicKey);
  const encMeta = await encryptMetadata(metadata, metaKey);
  const { reserveNext, hold } = request;

  /** What finalize sends over either transport. */
  const finalizeFields = async (uploadId: string) => {
    const wrapped = await wrapFileSecret(publicKey, request.id, uploadId, secret);
    return {
      wrapEnc: toBase64url(wrapped.enc),
      wrapCiphertext: toBase64url(wrapped.ciphertext),
      encryptedMeta: toBase64url(encMeta.ciphertext),
      metaNonce: toBase64url(encMeta.iv),
    };
  };

  // Same handshake and fallback as a normal upload. The stream is untouched until the
  // WebSocket is open, so a failed handshake can still go over HTTP.
  let ws: WebSocket | null = null;
  if (opts.wsEnabled) {
    try {
      ws = await openUploadWebSocket(apiBase, `${base}/ws`);
    } catch (err) {
      console.warn(
        "[upload-worker] WebSocket handshake failed, falling back to HTTP chunks:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (ws) {
    console.info("[upload-worker] transport=ws");
    post({ type: "transport", transport: "ws", fallback: false });
    return uploadViaWebSocket({
      ws,
      init: {
        request: {
          uploadToken: request.uploadToken,
          salt: toBase64url(salt),
          contentLength: encryptedSize,
          fileCount,
          ...(reserveNext ? { reserveNext: true } : {}),
          ...(hold ? { hold } : {}),
        },
      },
      finalize: finalizeFields,
      wsError: requestHttpError,
      encryptedStream: opts.encryptedStream,
      encryptedSize,
      speedLimit: opts.speedLimit,
      post,
    });
  }

  console.info("[upload-worker] transport=http");
  post({ type: "transport", transport: "http", fallback: opts.wsEnabled });
  return uploadViaHttpChunks({
    paths: {
      init: `${apiBase}${base}/init`,
      chunk: (uploadId, index) =>
        `${apiBase}${base}/${encodeURIComponent(uploadId)}/chunk?index=${index}`,
      finalize: (uploadId) => `${apiBase}${base}/${encodeURIComponent(uploadId)}/finalize`,
    },
    headers: {
      "X-Upload-Token": request.uploadToken,
      "X-Salt": toBase64url(salt),
      "X-Content-Length": String(encryptedSize),
      "X-File-Count": String(fileCount),
      ...(reserveNext ? { "X-Reserve-Next": "1" } : {}),
      ...(hold ? { "X-Slot-Hold": hold } : {}),
    },
    finalizeRequest: async (uploadId) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await finalizeFields(uploadId)),
    }),
    httpError: requestHttpError,
    onSession: (uploadId) => post({ type: "session", id: uploadId }),
    encryptedStream: opts.encryptedStream,
    encryptedSize,
    maxConcurrentUploads: opts.maxConcurrentUploads,
    chunkSize: CHUNK_UPLOAD_SIZE,
    post,
  });
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
  passwordAlgo?: "argon2id" | "argon2id-v2" | "pbkdf2";
}

/**
 * Open a WebSocket to the upload endpoint.  Resolves on `open` within
 * WS_HANDSHAKE_TIMEOUT_MS, rejects otherwise.  A rejection here is safe
 * to retry via HTTP chunks because no data has been consumed from the
 * encrypted stream yet.
 */
function openUploadWebSocket(apiBase: string, path = "/api/upload/ws"): Promise<WebSocket> {
  const WS_HANDSHAKE_TIMEOUT_MS = 10_000;
  return new Promise<WebSocket>((resolve, reject) => {
    let url: URL;
    try {
      const base = apiBase && apiBase.length > 0 ? apiBase : self.location.origin;
      url = new URL(path, base);
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
  /** What the init frame carries besides its type: the upload headers, or the request. */
  init: Record<string, unknown>;
  /** What the finalize frame carries besides its type, once the upload ID is known. */
  finalize?: (uploadId: string) => Promise<Record<string, unknown>>;
  /** Turns an error frame that names an HTTP status into the message the page shows. */
  wsError?: (status: number, message: string) => string;
  encryptedStream: ReadableStream<Uint8Array>;
  encryptedSize: number;
  /** Server-configured speed limit in bytes/sec.  0 = unlimited. */
  speedLimit: number;
  post: (m: UploadWorkerMessage) => void;
}

async function uploadViaWebSocket(opts: WsUploadOpts): Promise<{ id: string; hold?: string }> {
  const { ws, init, finalize, wsError, encryptedStream, encryptedSize, speedLimit, post } = opts;

  const FRAME_SIZE = 256 * 1024; // 256 KB per WebSocket frame
  // Sending pauses above HIGH_WATER queued in the socket and goes on below LOW_WATER. The
  // socket is checked every DRAIN_POLL_MS while it drains, since a WebSocket has no event for
  // that. Checked every 20 ms against 2 MiB, it ran dry between two checks at 100 MiB/s.
  const HIGH_WATER = 16 * 1024 * 1024;
  const LOW_WATER = 8 * 1024 * 1024;
  const DRAIN_POLL_MS = 4;
  // Progress goes to the page at most this often. One message per frame, more than a thousand
  // a second on a fast link, left the page behind, so the bar lagged and then jumped.
  const PROGRESS_INTERVAL_MS = 100;
  const READY_TIMEOUT_MS = 10_000;
  const DONE_TIMEOUT_MS = 5 * 60_000;

  let fatalError: Error | null = null;
  let doneId: string | null = null;
  let doneHold: string | undefined;
  let readyId: string | null = null;
  const readyWaiters: Array<() => void> = [];
  const doneWaiters: Array<() => void> = [];

  const notifyReady = () => { for (const f of readyWaiters.splice(0)) f(); };
  const notifyDone = () => { for (const f of doneWaiters.splice(0)) f(); };

  ws.addEventListener("message", (evt) => {
    if (typeof evt.data !== "string") return;
    let msg: { type?: string; id?: string; message?: string; status?: unknown };
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
      doneHold = holdOf(msg);
      notifyReady();
      notifyDone();
    } else if (msg.type === "error") {
      const message = msg.message ?? "Server error";
      fatalError = new Error(
        wsError && typeof msg.status === "number" ? wsError(msg.status, message) : message,
      );
      notifyReady();
      notifyDone();
    } else if (msg.type === "storage") {
      const backend = (msg as unknown as { backend?: string }).backend;
      if (backend === "s3" || backend === "filesystem") {
        post({ type: "storage", backend });
      }
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
    ws.send(JSON.stringify({ type: "init", ...init }));

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
    // A request upload wraps its secret to this ID, so it has to look like one the server makes.
    if (!UPLOAD_ID.test(readyId)) throw new Error("Server returned an invalid upload id");

    // Stream encrypted data in small frames with backpressure.
    const reader = encryptedStream.getReader();
    /** Bytes handed to the socket. What it has not sent yet is in ws.bufferedAmount. */
    let loaded = 0;
    let lastProgressAt = 0;
    const sendStartedAt = Date.now();

    /** Reports what the socket has really sent, not what waits in its buffer. */
    const reportProgress = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
      lastProgressAt = now;
      post({ type: "progress", loaded: Math.max(0, loaded - ws.bufferedAmount), total: encryptedSize });
    };

    const drain = async (below: number) => {
      while (ws.bufferedAmount > below) {
        if (fatalError) throw fatalError;
        await new Promise((r) => setTimeout(r, DRAIN_POLL_MS));
        reportProgress(false);
      }
    };

    const sendFrame = async (frame: Uint8Array<ArrayBuffer>) => {
      if (fatalError) throw fatalError;
      if (ws.bufferedAmount > HIGH_WATER) await drain(LOW_WATER);

      // Speed limit: pause if sending faster than the server allows.
      if (speedLimit > 0 && loaded > 0) {
        const elapsedMs = Date.now() - sendStartedAt;
        const expectedMs = (loaded / speedLimit) * 1000;
        const delayMs = expectedMs - elapsedMs;
        if (delayMs > 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      ws.send(frame);
      loaded += frame.byteLength;
      reportProgress(false);
    };

    // Every frame is filled once, straight from the records, into a buffer of its own. Joining
    // the rest of the last record with the next one copied most bytes three times.
    let frame = new Uint8Array(FRAME_SIZE);
    let filled = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      let offset = 0;
      while (offset < value.byteLength) {
        const take = Math.min(FRAME_SIZE - filled, value.byteLength - offset);
        frame.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === FRAME_SIZE) {
          await sendFrame(frame);
          frame = new Uint8Array(FRAME_SIZE);
          filled = 0;
        }
      }
    }
    if (filled > 0) await sendFrame(frame.subarray(0, filled));

    // The bar follows the socket until it has sent everything.
    await drain(0);
    reportProgress(true);

    if (fatalError) throw fatalError;

    // The server may still be writing what it buffered, to a bucket at the speed of its own
    // link, which held the bar at 99 % for seconds. The page shows that it is processing.
    post({ type: "phase", phase: "saving-meta" });

    // Send finalize and wait for done.
    ws.send(JSON.stringify({ type: "finalize", ...(finalize ? await finalize(readyId) : {}) }));
    await new Promise<void>((resolve, reject) => {
      if (doneId || fatalError) { resolve(); return; }
      const timer = setTimeout(() => {
        reject(new Error("WebSocket finalize timed out"));
      }, DONE_TIMEOUT_MS);
      doneWaiters.push(() => { clearTimeout(timer); resolve(); });
    });

    if (fatalError) throw fatalError;
    if (!doneId) throw new Error("Server did not confirm upload completion");
    if (doneId !== readyId) throw new Error("Server confirmed a different upload");
    return doneHold ? { id: doneId, hold: doneHold } : { id: doneId };
  } finally {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try { ws.close(); } catch { /* ignore */ }
    }
  }
}
