/**
 * Upload Web Worker - runs encryption and upload off the main thread, so the page stays
 * responsive during a large upload.
 *
 * The pipeline itself is `uploadEncrypted` from `@skysend/transfer`, shared with the CLI: the
 * file streams through the encryption into a WebSocket, or into chunk requests when the server
 * offers no WebSocket. This worker only adapts it to the page: Files in, messages out.
 *
 * In dev mode, uploads go directly to the server (bypassing the Vite proxy, which does not
 * stream request bodies), so the page passes the server's origin as `apiBase`.
 */
import type { RequestUploadMetadata } from "@skysend/crypto";
import { createApiClient, plaintextOf, uploadEncrypted } from "@skysend/transfer";
import { hashWasmArgon2 } from "./argon2";

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
  try {
    // WebKit drops webkitRelativePath when it posts a File to a worker, so the names in the zip
    // come from the metadata the page built.
    const files = msg.file ? [msg.file] : (msg.files ?? []);
    const result = await uploadEncrypted({
      api: createApiClient({ baseUrl: msg.apiBase }),
      openWebSocket: (url) => new WebSocket(url),
      origin: self.location?.origin,
      secret: new Uint8Array(msg.secret),
      salt: new Uint8Array(msg.salt),
      password: msg.password,
      argon2id: hashWasmArgon2,
      maxDownloads: msg.maxDownloads,
      expireSec: msg.expireSec,
      fileCount: msg.fileCount,
      metadata: msg.metadata,
      plaintext: plaintextOf(files, msg.metadata),
      ...(msg.request
        ? { request: { ...msg.request, publicKey: new Uint8Array(msg.request.publicKey) } }
        : {}),
      onPhase: (phase) => post({ type: "phase", phase }),
      onProgress: (loaded, total) => post({ type: "progress", loaded, total }),
      onTransport: (transport, fallback, reason) => {
        if (fallback) {
          console.warn(
            "[upload-worker] WebSocket handshake failed, falling back to HTTP chunks:",
            reason,
          );
        }
        console.info(`[upload-worker] transport=${transport}`);
        post({ type: "transport", transport, fallback });
      },
      onStorage: (backend) => post({ type: "storage", backend }),
      onSession: (id) => post({ type: "session", id }),
    });
    if (result.kind === "delivered") {
      post(
        result.hold
          ? { type: "delivered", id: result.id, hold: result.hold }
          : { type: "delivered", id: result.id },
      );
    } else {
      post({
        type: "done",
        id: result.id,
        ownerToken: result.ownerToken,
        effectiveSecret: result.effectiveSecret,
      });
    }
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
