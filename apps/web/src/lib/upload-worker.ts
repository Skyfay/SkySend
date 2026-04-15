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

    // ── Encrypt + Upload ───────────────────────────────
    // Pre-flight: verify server is reachable before starting
    try {
      const healthRes = await fetch(`${apiBase}/api/config`);
      if (!healthRes.ok) {
        throw new Error(`Server responded with ${healthRes.status}`);
      }
      await healthRes.json();
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
    // encrypt and upload in CHUNK_UPLOAD_SIZE pieces via sequential requests.
    const CHUNK_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB per request
    const encryptedStream = plaintextStream.pipeThrough(
      createEncryptStream(keys.fileKey),
    );
    const reader = encryptedStream.getReader();

    // Initialize the upload session on the server
    const initRes = await fetch(`${apiBase}/api/upload/init`, {
      method: "POST",
      headers,
    });
    if (!initRes.ok) {
      const data = await initRes.json().catch(() => ({ error: "Upload init failed" }));
      throw new Error((data as { error?: string }).error ?? "Upload init failed");
    }
    const { id: uploadId } = (await initRes.json()) as { id: string };

    // Stream encrypted data in chunks
    let loaded = 0;
    let chunkParts: Uint8Array[] = [];
    let chunkSize = 0;

    const uploadChunk = async (data: Blob) => {
      const res = await fetch(`${apiBase}/api/upload/${encodeURIComponent(uploadId)}/chunk`, {
        method: "POST",
        body: data,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Chunk upload failed" }));
        throw new Error((errData as { error?: string }).error ?? "Chunk upload failed");
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunkParts.push(value);
      chunkSize += value.byteLength;

      // When we have enough data, upload a chunk
      if (chunkSize >= CHUNK_UPLOAD_SIZE) {
        const blob = new Blob(chunkParts as unknown as BlobPart[]);
        chunkParts = [];
        const uploadedChunkSize = chunkSize;
        chunkSize = 0;
        await uploadChunk(blob);
        // Report progress after the chunk has been fully uploaded
        // (including server -> S3 forwarding). This ensures the bar
        // reflects actual end-to-end progress, not just encryption speed.
        loaded += uploadedChunkSize;
        post({ type: "progress", loaded, total: encryptedSize });
      }
    }

    // Upload remaining data
    if (chunkSize > 0) {
      const blob = new Blob(chunkParts as unknown as BlobPart[]);
      const uploadedChunkSize = chunkSize;
      chunkParts = [];
      chunkSize = 0;
      await uploadChunk(blob);
      loaded += uploadedChunkSize;
      post({ type: "progress", loaded, total: encryptedSize });
    }

    // Finalize the upload
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

    const uploadResult = { id: uploadId };

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
