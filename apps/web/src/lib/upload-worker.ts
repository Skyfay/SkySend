/**
 * Upload Web Worker - handles encryption + upload off the main thread.
 *
 * This keeps the UI responsive during large file uploads by running
 * the entire crypto + network pipeline in a dedicated thread.
 *
 * Flow: receive file -> derive keys -> encrypt stream -> collect buffer -> XHR upload
 *
 * We use XHR instead of fetch for the upload because:
 * 1. fetch() with ReadableStream body requires `duplex: "half"` which doesn't
 *    work through the Vite dev proxy (http-proxy) and has limited browser support
 * 2. XHR provides native upload.onprogress for real progress tracking
 * 3. XHR with ArrayBuffer body works reliably through any proxy
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
} from "@skysend/crypto";

// ── Message Types ──────────────────────────────────────

export interface UploadWorkerRequest {
  /** File to upload (single-file mode). */
  file?: File;
  /** Pre-zipped data (multi-file mode). Transferred, not copied. */
  zipData?: ArrayBuffer;
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
    } else if (msg.zipData) {
      const zipBytes = new Uint8Array(msg.zipData);
      plaintextSize = zipBytes.byteLength;
      let offset = 0;
      plaintextStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= zipBytes.length) {
            controller.close();
            return;
          }
          const end = Math.min(offset + 65536, zipBytes.length);
          controller.enqueue(zipBytes.subarray(offset, end));
          offset = end;
        },
      });
    } else {
      throw new Error("No file or zip data provided");
    }

    // ── Encrypt ──────────────────────────────────────
    post({ type: "phase", phase: "encrypting" });

    const encryptedStream = plaintextStream.pipeThrough(
      createEncryptStream(keys.fileKey),
    );
    const encryptedSize = calculateEncryptedSize(plaintextSize);

    // Collect encrypted stream into a buffer.
    // This runs in the worker so the main thread stays responsive.
    const encryptedBuffer = await collectStream(encryptedStream, encryptedSize);

    // ── Upload via XHR ───────────────────────────────
    post({ type: "phase", phase: "uploading" });

    const authToken = await computeAuthToken(keys.authKey);
    const ownerToken = await computeOwnerToken(effectiveSecret, salt);
    const ownerTokenB64 = toBase64url(ownerToken);

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

    const uploadResult = await xhrUpload(
      "/api/upload",
      encryptedBuffer,
      headers,
      (loaded, total) => {
        post({ type: "progress", loaded, total });
      },
    );

    // ── Save Encrypted Metadata ──────────────────────
    post({ type: "phase", phase: "saving-meta" });

    const encMeta = await encryptMetadata(msg.metadata, keys.metaKey);
    const encryptedMeta = btoa(
      String.fromCharCode(...encMeta.ciphertext),
    );
    const nonce = btoa(String.fromCharCode(...encMeta.iv));

    const metaRes = await fetch(
      `/api/meta/${encodeURIComponent(uploadResult.id)}`,
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
    post({
      type: "error",
      message: err instanceof Error ? err.message : "Upload failed",
    });
  }
};

function post(msg: UploadWorkerMessage) {
  self.postMessage(msg);
}

/**
 * Collect a ReadableStream into a Blob.
 * Uses Blob instead of a single Uint8Array to avoid contiguous memory
 * allocation - critical for large files (>2 GB).
 * Reports encryption progress as chunks are read.
 */
async function collectStream(
  stream: ReadableStream<Uint8Array>,
  expectedSize: number,
): Promise<Blob> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let offset = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    offset += value.byteLength;
    post({
      type: "progress",
      loaded: Math.min(offset, expectedSize),
      total: expectedSize,
    });
  }

  // Blob holds references to chunks - no contiguous copy needed
  return new Blob(chunks as unknown as BlobPart[]);
}

/**
 * Upload data via XMLHttpRequest with progress tracking.
 * XHR is used because fetch() doesn't support upload progress
 * and streaming fetch (duplex: "half") doesn't work through proxies.
 */
function xhrUpload(
  url: string,
  data: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void,
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded, e.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const json = JSON.parse(xhr.responseText);
          resolve(json as { id: string });
        } catch {
          reject(new Error("Invalid server response"));
        }
      } else {
        try {
          const json = JSON.parse(xhr.responseText);
          reject(new Error((json as { error?: string }).error ?? "Upload failed"));
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error("Upload failed - network error"));
    };

    xhr.send(data);
  });
}
