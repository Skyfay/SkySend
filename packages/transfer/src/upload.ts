/**
 * An upload from plaintext to share link: keys, encryption, the transport, the metadata. The
 * caller hands in the plaintext as a stream of known size, a single file or a zip from
 * `zipStream`, and what differs between platforms: the API client, how to open a WebSocket and
 * the Argon2id of the platform.
 *
 * The stream goes straight through the encryption into the socket or into chunk requests.
 * Backpressure from the network slows the encryption down, so memory stays flat whatever the size.
 */
import {
  applyPasswordProtection,
  calculateEncryptedSize,
  computeAuthToken,
  computeOwnerToken,
  createEncryptStream,
  deriveKeyFromPassword,
  deriveKeys,
  encryptMetadata,
  expectedBaseNonce,
  NONCE_LENGTH,
  PASSWORD_SALT_LENGTH,
  randomBytes,
  toBase64url,
  wrapFileSecret,
  type Argon2idHashFn,
  type RequestUploadMetadata,
} from "@skysend/crypto";
import { ApiError, holdOf, isUploadId, type ApiClient, type ServerConfig } from "./api.js";
import { zipSize, zipStream } from "./zip.js";

/** A file to upload: a browser File, or a file the CLI opened with `fs.openAsBlob`. */
export interface SourceFile {
  size: number;
  stream(): ReadableStream<Uint8Array>;
}

/**
 * The plaintext of an upload: the one file as it is, or the zip of several, written while the
 * upload reads it under the names the metadata lists, so the recipient gets exactly the paths
 * they are shown.
 */
export function plaintextOf(
  files: readonly SourceFile[],
  metadata: RequestUploadMetadata,
): { stream: ReadableStream<Uint8Array>; size: number } {
  if (metadata.type === "archive") {
    const names = metadata.files.map((file) => file.name);
    if (names.length !== files.length || files.length === 0) {
      throw new Error("The file list does not match");
    }
    const entries = files.map((file, i) => ({
      name: names[i]!,
      size: file.size,
      stream: () => file.stream(),
    }));
    return { stream: zipStream(entries), size: zipSize(entries) };
  }
  if (files.length !== 1) throw new Error("No file or zip data provided");
  return { stream: files[0]!.stream(), size: files[0]!.size };
}

/**
 * Bytes per chunk request of the HTTP transport. Chrome and Brave serialize large HTTP/2 POST
 * bodies through reverse proxies, so the chunks stay at 10 MB.
 */
export const CHUNK_UPLOAD_SIZE = 10 * 1024 * 1024;

/**
 * How far the HTTP transport sends ahead of the oldest chunk the server has not confirmed. The
 * server writes chunks in order and holds at most 64 that wait for an earlier one, then refuses
 * the next with 429. Behind Nginx a single request can hang for seconds while the others pass,
 * which ran a fast client into that limit and failed the upload. Within this window it waits
 * for the slow chunk instead.
 */
export const CHUNK_WINDOW = 32;

/** What an upload reports while it runs. */
export interface UploadEvents {
  /** "uploading" once the server answered, "saving-meta" once every byte is out. */
  onPhase?: (phase: "uploading" | "saving-meta") => void;
  /** Bytes of ciphertext the server has, out of all of them. */
  onProgress?: (loaded: number, total: number) => void;
  /** The transport that runs. `fallback` when the WebSocket was offered but its handshake failed. */
  onTransport?: (transport: "ws" | "http", fallback: boolean, reason?: string) => void;
  /** Where the server stores the upload, as its WebSocket reports it. */
  onStorage?: (backend: "s3" | "filesystem") => void;
  /** An upload into a file request opened its session, so a cancel can give its slot back. */
  onSession?: (uploadId: string) => void;
}

/**
 * Opens a WebSocket to an absolute ws:// or wss:// URL. A browser passes `new WebSocket(url)`,
 * a client without the session cookie one that sends its OIDC token with the handshake.
 */
export type OpenWebSocket = (url: string) => WebSocket;

/** An upload into a file request, from the upload link of the sender. */
export interface RequestTarget {
  id: string;
  uploadToken: string;
  /** The public key of the request, from the upload link and never from the server. */
  publicKey: Uint8Array;
  /** The first part of a submission, which reserves the slot of its second part too. */
  reserveNext?: boolean;
  /** The slot the first part of a submission held for this one. */
  hold?: string;
}

export interface UploadOptions extends UploadEvents {
  api: ApiClient;
  /** Without it, or when the server offers no WebSocket, the upload goes over HTTP chunks. */
  openWebSocket?: OpenWebSocket;
  /**
   * The origin the API client's paths are relative to, when its base URL is "" like the page's.
   * Only the WebSocket needs an absolute URL.
   */
  origin?: string;
  /** The server's config, fetched when not given. */
  config?: ServerConfig;
  /** Master secret (32 bytes) and HKDF salt, made by the caller. */
  secret: Uint8Array;
  salt: Uint8Array;
  /** The password of the share, "" for none. */
  password: string;
  argon2id: Argon2idHashFn;
  maxDownloads: number;
  expireSec: number;
  fileCount: number;
  /** What the recipient learns about the files, encrypted at the end. */
  metadata: RequestUploadMetadata;
  /** The plaintext: one file, or the zip of several, of exactly `size` bytes. */
  plaintext: { stream: ReadableStream<Uint8Array>; size: number };
  request?: RequestTarget;
}

/** A share: the link is `/file/<id>#<effectiveSecret>`, the owner token deletes it. */
export interface SharedUpload {
  kind: "share";
  id: string;
  ownerToken: string;
  effectiveSecret: string;
}

/** An upload into a file request. The sender gets nothing to share, only the held slot. */
export interface DeliveredUpload {
  kind: "delivered";
  id: string;
  hold?: string;
}

/** Base64 as `btoa` writes it, built in pieces so no engine meets a limit on arguments. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/** The secret a link carries, and what the server keeps so a recipient can undo the password. */
export interface ProtectedSecret {
  /** The master secret, or with a password the master secret XOR the key of the password. */
  effectiveSecret: Uint8Array;
  passwordSalt?: Uint8Array;
  passwordAlgo?: "argon2id-v2";
}

/**
 * Puts the password of a share or a note over its secret, so the link alone opens nothing.
 * Without a password the link carries the secret itself. `keysFromLink` undoes it.
 */
export async function protectSecret(
  secret: Uint8Array,
  password: string,
  argon2id: Argon2idHashFn,
): Promise<ProtectedSecret> {
  if (password.length === 0) return { effectiveSecret: secret };
  const passwordSalt = randomBytes(PASSWORD_SALT_LENGTH);
  const { key, algorithm } = await deriveKeyFromPassword(password, passwordSalt, argon2id);
  return {
    effectiveSecret: applyPasswordProtection(secret, key),
    passwordSalt,
    passwordAlgo: algorithm,
  };
}

/** Why the server refused to open an upload into a request, as the key a client shows. */
export function requestHttpError(status: number, message: string): string {
  // The upload quota of the sender answers with 413 or 429 too, and names itself.
  if ((status === 413 || status === 429) && /quota/i.test(message)) return "quota";
  if (status === 404 || status === 403) return "gone";
  if (status === 409) return "full";
  if (status === 410) return "closed";
  if (status === 413) return "tooLarge";
  return message;
}

/** Runs `call` and turns an ApiError into the key of `requestHttpError`. */
async function asRequestError<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof ApiError) {
      throw new Error(requestHttpError(err.status, err.message), { cause: err });
    }
    throw err;
  }
}

export async function uploadEncrypted(
  options: UploadOptions,
): Promise<SharedUpload | DeliveredUpload> {
  const { api, request } = options;
  const keys = await deriveKeys(options.secret, options.salt);

  const { effectiveSecret, passwordSalt, passwordAlgo } = await protectSecret(
    options.secret,
    options.password,
    options.argon2id,
  );
  const hasPassword = passwordSalt !== undefined;

  // ── What the server offers ──
  let config = options.config;
  if (!config) {
    try {
      config = await api.fetchConfig();
    } catch (e) {
      throw new Error(
        `Server unreachable at ${api.url("") || "(same-origin)"}: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  }
  const maxConcurrentUploads =
    config.fileUploadConcurrentChunks > 0 ? config.fileUploadConcurrentChunks : 3;
  const speedLimit = config.fileUploadSpeedLimit > 0 ? config.fileUploadSpeedLimit : 0;
  const wsEnabled = config.fileUploadWs && options.openWebSocket !== undefined;

  options.onPhase?.("uploading");

  // The recipient needs the archive size to tell a complete download from one the server cut
  // short. The stream is encrypted with the base nonce the metadata names, so the recipient can
  // check the header against it. A metadata without one gets one here.
  const encryptedSize = calculateEncryptedSize(options.plaintext.size);
  const withSize: RequestUploadMetadata =
    options.metadata.type === "archive"
      ? { ...options.metadata, archiveSize: options.plaintext.size }
      : options.metadata;
  const metadata: RequestUploadMetadata = withSize.streamNonce
    ? withSize
    : { ...withSize, streamNonce: toBase64url(randomBytes(NONCE_LENGTH)) };
  const encryptedStream = options.plaintext.stream.pipeThrough(
    createEncryptStream(keys.fileKey, expectedBaseNonce(metadata)),
  );

  /** Opens the WebSocket of `path` when the server offers it, null to go over HTTP. */
  const socketFor = async (path: string): Promise<WebSocket | null> => {
    if (!wsEnabled) return null;
    try {
      return await openUploadWebSocket(
        options.openWebSocket!,
        wsUrl(api.url(path), options.origin),
      );
    } catch (err) {
      options.onTransport?.("http", true, err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  // ── Upload into a file request ──
  if (request) {
    const target = { requestId: request.id };
    const base = `/api/request/${encodeURIComponent(request.id)}/upload`;
    const encMeta = await encryptMetadata(metadata, keys.metaKey);
    /** What finalize carries over either transport. The wrap binds the upload ID. */
    const finalizeFields = async (uploadId: string) => {
      const wrapped = await wrapFileSecret(request.publicKey, request.id, uploadId, options.secret);
      return {
        wrapEnc: toBase64url(wrapped.enc),
        wrapCiphertext: toBase64url(wrapped.ciphertext),
        encryptedMeta: toBase64url(encMeta.ciphertext),
        metaNonce: toBase64url(encMeta.iv),
      };
    };
    const { reserveNext, hold } = request;

    // The stream is untouched until the WebSocket is open, so a failed handshake still goes over HTTP.
    const ws = await socketFor(`${base}/ws`);
    if (ws) {
      options.onTransport?.("ws", false);
      const delivered = await uploadViaWebSocket(ws, {
        init: {
          request: {
            uploadToken: request.uploadToken,
            salt: toBase64url(options.salt),
            contentLength: encryptedSize,
            fileCount: options.fileCount,
            ...(reserveNext ? { reserveNext: true } : {}),
            ...(hold ? { hold } : {}),
          },
        },
        finalize: finalizeFields,
        wsError: requestHttpError,
        encryptedStream,
        encryptedSize,
        speedLimit,
        events: options,
      });
      return { kind: "delivered", ...delivered };
    }

    if (!wsEnabled) options.onTransport?.("http", false);
    const delivered = await uploadViaHttpChunks({
      api,
      target,
      headers: {
        "X-Upload-Token": request.uploadToken,
        "X-Salt": toBase64url(options.salt),
        "X-Content-Length": String(encryptedSize),
        "X-File-Count": String(options.fileCount),
        ...(reserveNext ? { "X-Reserve-Next": "1" } : {}),
        ...(hold ? { "X-Slot-Hold": hold } : {}),
      },
      finalizeRequest: async (uploadId) => ({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await finalizeFields(uploadId)),
      }),
      mapErrors: true,
      encryptedStream,
      encryptedSize,
      maxConcurrentUploads,
      events: options,
    });
    return { kind: "delivered", ...delivered };
  }

  // ── A normal upload ──
  const authToken = toBase64url(await computeAuthToken(keys.authKey));
  const ownerToken = toBase64url(await computeOwnerToken(effectiveSecret, options.salt));

  let uploadId: string;
  const ws = await socketFor("/api/upload/ws");
  if (ws) {
    options.onTransport?.("ws", false);
    ({ id: uploadId } = await uploadViaWebSocket(ws, {
      init: {
        headers: {
          authToken,
          ownerToken,
          salt: toBase64url(options.salt),
          maxDownloads: options.maxDownloads,
          expireSec: options.expireSec,
          fileCount: options.fileCount,
          contentLength: encryptedSize,
          hasPassword,
          passwordSalt: passwordSalt ? toBase64url(passwordSalt) : undefined,
          passwordAlgo: hasPassword ? passwordAlgo : undefined,
        },
      },
      encryptedStream,
      encryptedSize,
      speedLimit,
      events: options,
    }));
  } else {
    if (!wsEnabled) options.onTransport?.("http", false);
    ({ id: uploadId } = await uploadViaHttpChunks({
      api,
      target: {},
      headers: {
        "X-Auth-Token": authToken,
        "X-Owner-Token": ownerToken,
        "X-Salt": toBase64url(options.salt),
        "X-Max-Downloads": String(options.maxDownloads),
        "X-Expire-Sec": String(options.expireSec),
        "X-File-Count": String(options.fileCount),
        "X-Has-Password": String(hasPassword),
        "X-Content-Length": String(encryptedSize),
        ...(passwordSalt && passwordAlgo
          ? { "X-Password-Salt": toBase64url(passwordSalt), "X-Password-Algo": passwordAlgo }
          : {}),
      },
      finalizeRequest: async () => ({ headers: { "X-Owner-Token": ownerToken } }),
      mapErrors: false,
      encryptedStream,
      encryptedSize,
      maxConcurrentUploads,
      events: options,
    }));
  }

  // ── The metadata, which the server only gets once the upload is stored ──
  options.onPhase?.("saving-meta");
  const encMeta = await encryptMetadata(metadata, keys.metaKey);
  try {
    await api.saveMeta(uploadId, ownerToken, toBase64(encMeta.ciphertext), toBase64(encMeta.iv));
  } catch (err) {
    throw new Error("Failed to save metadata", { cause: err });
  }

  return { kind: "share", id: uploadId, ownerToken, effectiveSecret: toBase64url(effectiveSecret) };
}

// ── HTTP chunks ────────────────────────────────────────

interface HttpUploadOptions {
  api: ApiClient;
  target: { requestId?: string };
  headers: Record<string, string>;
  /** The finalize request, which may need the upload ID. */
  finalizeRequest: (uploadId: string) => Promise<RequestInit>;
  /** Whether a refused init or finalize is named by `requestHttpError`. */
  mapErrors: boolean;
  encryptedStream: ReadableStream<Uint8Array>;
  encryptedSize: number;
  maxConcurrentUploads: number;
  events: UploadEvents;
}

async function uploadViaHttpChunks(
  opts: HttpUploadOptions,
): Promise<{ id: string; hold?: string }> {
  const { api, target, encryptedSize, maxConcurrentUploads, events } = opts;
  const named = <T>(call: () => Promise<T>) => (opts.mapErrors ? asRequestError(call) : call());

  const reader = opts.encryptedStream.getReader();
  const uploadId = await named(() => api.uploadInit(opts.headers, target));
  if (target.requestId !== undefined) events.onSession?.(uploadId);

  let loaded = 0;
  let parts: Uint8Array[] = [];
  let partsSize = 0;
  let nextIndex = 0;
  let uploadError: Error | null = null;
  /** Requests in flight, and the index of each. */
  const active = new Map<number, Promise<void>>();

  const send = (index: number, body: Blob, size: number) => {
    const request = api
      .uploadChunk(uploadId, index, body, target)
      .then(() => {
        loaded += size;
        events.onProgress?.(loaded, encryptedSize);
      })
      .catch((err: unknown) => {
        uploadError = err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => active.delete(index));
    active.set(index, request);
  };

  /** Waits while too many requests run, or the oldest open one lags a window behind. */
  const room = async (index: number) => {
    while (
      active.size >= maxConcurrentUploads ||
      (active.size > 0 && index - Math.min(...active.keys()) >= CHUNK_WINDOW)
    ) {
      await Promise.race(active.values());
      if (uploadError) throw uploadError;
    }
  };

  const flush = async () => {
    const index = nextIndex++;
    await room(index);
    send(index, new Blob(parts as BlobPart[]), partsSize);
    parts = [];
    partsSize = 0;
    if (uploadError) throw uploadError;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    partsSize += value.byteLength;
    if (partsSize >= CHUNK_UPLOAD_SIZE) await flush();
  }
  if (partsSize > 0) await flush();

  await Promise.all(active.values());
  if (uploadError) throw uploadError;

  // Every chunk is in, the server may still be writing them to storage.
  events.onPhase?.("saving-meta");
  const init = await opts.finalizeRequest(uploadId);
  const { hold } = await named(() => api.uploadFinalize(uploadId, init, target));
  return hold ? { id: uploadId, hold } : { id: uploadId };
}

// ── WebSocket ──────────────────────────────────────────

const WS_OPEN = 1;
const WS_CONNECTING = 0;

/** The ws:// or wss:// URL of an API URL, resolved against `origin` when it is relative. */
function wsUrl(apiUrl: string, origin: string | undefined): string {
  const url = new URL(apiUrl, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * Opens the upload WebSocket. Resolves on `open` within 10 seconds, rejects otherwise. A
 * rejection is safe to retry over HTTP, since nothing was read from the stream yet.
 */
function openUploadWebSocket(open: OpenWebSocket, url: string): Promise<WebSocket> {
  const HANDSHAKE_TIMEOUT_MS = 10_000;
  return new Promise<WebSocket>((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = open(url);
    } catch (err) {
      reject(err instanceof Error ? err : new Error("WebSocket handshake failed"));
      return;
    }
    ws.binaryType = "arraybuffer";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // Closing a socket that never opened can throw.
      }
      reject(new Error("WebSocket handshake timed out"));
    }, HANDSHAKE_TIMEOUT_MS);
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

interface WsUploadOptions {
  /** What the init frame carries besides its type: the upload headers, or the request. */
  init: Record<string, unknown>;
  /** What the finalize frame carries besides its type, once the upload ID is known. */
  finalize?: (uploadId: string) => Promise<Record<string, unknown>>;
  /** Turns an error frame that names an HTTP status into the message to show. */
  wsError?: (status: number, message: string) => string;
  encryptedStream: ReadableStream<Uint8Array>;
  encryptedSize: number;
  /** Server-configured speed limit in bytes/sec. 0 = unlimited. */
  speedLimit: number;
  events: UploadEvents;
}

async function uploadViaWebSocket(
  ws: WebSocket,
  opts: WsUploadOptions,
): Promise<{ id: string; hold?: string }> {
  const { init, finalize, wsError, encryptedStream, encryptedSize, speedLimit, events } = opts;

  const FRAME_SIZE = 256 * 1024;
  // Sending pauses above HIGH_WATER queued in the socket and goes on below LOW_WATER. The
  // socket is checked every DRAIN_POLL_MS while it drains, since a WebSocket has no event for
  // that. Checked every 20 ms against 2 MiB, it ran dry between two checks at 100 MiB/s.
  const HIGH_WATER = 16 * 1024 * 1024;
  const LOW_WATER = 8 * 1024 * 1024;
  const DRAIN_POLL_MS = 4;
  // Progress goes out at most this often. One report per frame, more than a thousand a second
  // on a fast link, left the page behind, so the bar lagged and then jumped.
  const PROGRESS_INTERVAL_MS = 100;
  const READY_TIMEOUT_MS = 10_000;
  const DONE_TIMEOUT_MS = 5 * 60_000;

  let fatalError: Error | null = null;
  let doneId: string | null = null;
  let doneHold: string | undefined;
  let readyId: string | null = null;
  const readyWaiters: Array<() => void> = [];
  const doneWaiters: Array<() => void> = [];

  const notifyReady = () => {
    for (const f of readyWaiters.splice(0)) f();
  };
  const notifyDone = () => {
    for (const f of doneWaiters.splice(0)) f();
  };

  ws.addEventListener("message", (evt) => {
    if (typeof evt.data !== "string") return;
    let msg: {
      type?: unknown;
      id?: unknown;
      message?: unknown;
      status?: unknown;
      backend?: unknown;
    };
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
      const message = typeof msg.message === "string" ? msg.message : "Server error";
      fatalError = new Error(
        wsError && typeof msg.status === "number" ? wsError(msg.status, message) : message,
      );
      notifyReady();
      notifyDone();
    } else if (msg.type === "storage") {
      if (msg.backend === "s3" || msg.backend === "filesystem") events.onStorage?.(msg.backend);
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
    ws.send(JSON.stringify({ type: "init", ...init }));

    await new Promise<void>((resolve, reject) => {
      if (readyId || fatalError) {
        resolve();
        return;
      }
      const timer = setTimeout(
        () => reject(new Error("WebSocket ready timed out")),
        READY_TIMEOUT_MS,
      );
      readyWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (fatalError) throw fatalError;
    if (!readyId) throw new Error("Server did not return an upload id");
    // A request upload wraps its secret to this ID, so it has to look like one the server makes.
    if (!isUploadId(readyId)) throw new Error("Server returned an invalid upload id");
    const uploadId: string = readyId;

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
      events.onProgress?.(Math.max(0, loaded - ws.bufferedAmount), encryptedSize);
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
        const delayMs = (loaded / speedLimit) * 1000 - (Date.now() - sendStartedAt);
        if (delayMs > 1) await new Promise((r) => setTimeout(r, delayMs));
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

    // The progress follows the socket until it has sent everything.
    await drain(0);
    reportProgress(true);
    if (fatalError) throw fatalError;

    // The server may still be writing what it buffered, to a bucket at the speed of its own
    // link, which held the bar at 99 % for seconds. The client shows that it is processing.
    events.onPhase?.("saving-meta");

    ws.send(JSON.stringify({ type: "finalize", ...(finalize ? await finalize(uploadId) : {}) }));
    await new Promise<void>((resolve, reject) => {
      if (doneId || fatalError) {
        resolve();
        return;
      }
      const timer = setTimeout(
        () => reject(new Error("WebSocket finalize timed out")),
        DONE_TIMEOUT_MS,
      );
      doneWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });

    if (fatalError) throw fatalError;
    if (!doneId) throw new Error("Server did not confirm upload completion");
    if (doneId !== uploadId) throw new Error("Server confirmed a different upload");
    return doneHold ? { id: doneId, hold: doneHold } : { id: doneId };
  } finally {
    if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) {
      try {
        ws.close();
      } catch {
        // Already closing.
      }
    }
  }
}
