import { useState, useCallback, useRef } from "react";
import {
  encryptedMetadataLength,
  generateSecret,
  generateSalt,
  MAX_ENCRYPTED_METADATA_BYTES,
  NONCE_LENGTH,
  randomBytes,
  toBase64url,
  type RequestUploadMetadata,
} from "@skysend/crypto";
import { buildShareLink } from "@skysend/transfer";
import { archiveMetadata } from "@/lib/archive";
import { saveUpload } from "@/lib/upload-store";
import type { UploadWorkerMessage } from "@/lib/upload-worker";
import { formatBytes, getBrowserInfo } from "@/lib/utils";

export type UploadPhase =
  | "idle"
  | "uploading"
  | "saving-meta"
  | "done"
  | "error";

export interface UploadDebugInfo {
  transport: "ws" | "http" | null;
  fallback: boolean;
  storage: "s3" | "filesystem" | null;
  browser: string;
  /**
   * `detail` is a measured value or an error shown beside the message, like the average
   * speed. `failed` marks the event an upload ended with when it did not arrive.
   */
  events: Array<{ time: string; message: string; detail?: string; failed?: boolean }>;
}

interface UploadState {
  phase: UploadPhase;
  progress: number;
  speed: string | null;
  averageSpeed: string | null;
  shareLink: string | null;
  error: string | null;
  uploadId: string | null;
  debugInfo: UploadDebugInfo | null;
}

interface ShareUploadOptions {
  files: File[];
  maxDownloads: number;
  expireSec: number;
  password: string;
  request?: undefined;
}

/**
 * An upload into a file request: the file secret is wrapped to the requester's public key,
 * and the sender gets no share link and no entry in My Links. With `note`, a serialized and
 * padded note document, the upload is that note instead of files.
 */
interface RequestUploadOptions {
  files: File[];
  note?: string;
  /** Ties the uploads a sender sends together, files and a note, see Submission in the crypto package. */
  submission?: string;
  /** The first part of a submission, which reserves the slot of its second part too. */
  reserveNext?: boolean;
  /** The slot the first part of a submission held for this one. */
  hold?: string;
  request: { id: string; uploadToken: string; publicKey: Uint8Array };
}

/** What a finished upload hands back: the slot held for the next part of its submission. */
export interface UploadResult {
  hold?: string;
}

/** How a cancelled upload ends its promise. Cancel already reset the state. */
class UploadCancelled extends Error {}

type UploadOptions = ShareUploadOptions | RequestUploadOptions;

/**
 * Determine the API base URL.
 * In dev mode (Vite), upload requests go directly to the server
 * to bypass the Vite proxy which doesn't support streaming request bodies.
 * In production, same-origin requests are used (empty string).
 */
function getApiBase(): string {
  /* v8 ignore next */
  if (!import.meta.env.DEV) return "";
  return import.meta.env.VITE_API_BASE ?? "http://localhost:3000";
}

export function useUpload() {
  const [state, setState] = useState<UploadState>({
    phase: "idle",
    progress: 0,
    speed: null,
    averageSpeed: null,
    shareLink: null,
    error: null,
    uploadId: null,
    debugInfo: null,
  });
  const workerRef = useRef<Worker | null>(null);
  /** Ends the promise of a running upload when it is cancelled, so no caller waits forever. */
  const abortRef = useRef<((err: Error) => void) | null>(null);
  /** The open session of an upload into a request, so a cancel can give its slot back. */
  const requestSessionRef = useRef<{ requestId: string; uploadId: string } | null>(null);
  /** Counts cancels, so a cancel before the worker exists still ends the upload. */
  const cancelsRef = useRef(0);
  /** The submission of the last upload into a request, whose note continues its timeline. */
  const lastSubmissionRef = useRef<string | undefined>(undefined);

  /** Ends the session on the server, best effort. Its reservation is free again at once. */
  const endRequestSession = useCallback(() => {
    const session = requestSessionRef.current;
    requestSessionRef.current = null;
    if (!session) return;
    const path = `/api/request/${encodeURIComponent(session.requestId)}/upload/${encodeURIComponent(session.uploadId)}`;
    fetch(`${getApiBase()}${path}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const reset = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setState({
      phase: "idle",
      progress: 0,
      speed: null,
      averageSpeed: null,
      shareLink: null,
      error: null,
      uploadId: null,
      debugInfo: null,
    });
  }, []);

  const cancel = useCallback(() => {
    cancelsRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    abortRef.current?.(new UploadCancelled());
    abortRef.current = null;
    endRequestSession();
    setState({
      phase: "idle",
      progress: 0,
      speed: null,
      averageSpeed: null,
      shareLink: null,
      error: null,
      uploadId: null,
      debugInfo: null,
    });
  }, [endRequestSession]);

  /** Resolves once the upload is done, with null when it failed or was cancelled. */
  const upload = useCallback(async (options: UploadOptions): Promise<UploadResult | null> => {
    const { request } = options;
    const cancels = cancelsRef.current;
    const submission = request ? options.submission : undefined;
    const slot = request ? { reserveNext: options.reserveNext, hold: options.hold } : {};
    const note = request ? options.note : undefined;
    // A note travels like a single file, with metadata that names it a note.
    const files = note === undefined ? options.files : [new File([note], "note")];
    const maxDownloads = request ? 0 : options.maxDownloads;
    const expireSec = request ? 0 : options.expireSec;
    const password = request ? "" : options.password;
    // The note of a submission goes out after its files, so the panel keeps their timeline.
    const continues = submission !== undefined && submission === lastSubmissionRef.current;
    lastSubmissionRef.current = submission;

    try {
      // Pre-flight: verify all files are still readable
      for (const file of files) {
        try {
          await file.slice(0, 1).arrayBuffer();
        } catch {
          throw new Error("fileNotReadable");
        }
      }
      // A cancel during the reads above found no worker to stop.
      if (cancelsRef.current !== cancels) throw new UploadCancelled();

      // Generate secret + salt on main thread (fast, just random bytes)
      const secret = generateSecret();
      const salt = generateSalt();

      // Build metadata and file names (main thread - needs DOM File info)
      let metadata: RequestUploadMetadata;
      const fileNames: string[] = [];

      if (note !== undefined) {
        metadata = { type: "note", size: files[0]!.size };
      } else if (files.length === 1) {
        const file = files[0]!;
        metadata = {
          type: "single",
          name: file.name,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        };
        fileNames.push(file.name);
      } else {
        metadata = archiveMetadata(files);
        fileNames.push(...metadata.files.map((f) => f.name));
      }

      if (submission) metadata = { ...metadata, submission };
      // The base nonce of the encrypted stream, which the worker encrypts with. In the
      // authenticated metadata it lets the recipient refuse a stream whose header the server
      // changed to reorder its records.
      metadata = { ...metadata, streamNonce: toBase64url(randomBytes(NONCE_LENGTH)) };
      // The server takes the metadata only after the upload, so a list of names too long for it
      // has to stop the upload before it starts. The pages check the same with archiveMetadataFits.
      if (encryptedMetadataLength(metadata) > MAX_ENCRYPTED_METADATA_BYTES) {
        throw new Error("fileListTooLong");
      }
      const archive =
        metadata.type === "archive"
          ? {
              time: new Date().toISOString(),
              message: `Zip of ${files.length} files, written while uploading`,
              detail: formatBytes(metadata.archiveSize ?? 0),
            }
          : null;

      // Spawn upload worker - zip (if multi-file), encryption + upload all run off the main
      // thread, in one pass over the files.
      setState((s) => ({
        ...s,
        phase: "uploading",
        progress: 0,
        speed: null,
        debugInfo: {
          transport: null,
          fallback: false,
          storage: null,
          browser: getBrowserInfo(),
          events: [
            ...(continues && s.debugInfo ? s.debugInfo.events : []),
            ...(archive ? [archive] : []),
          ],
        },
      }));

      const worker = new Worker(
        new URL("../lib/upload-worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      // Transfer buffers (zero-copy) instead of cloning
      const transferable: Transferable[] = [
        secret.buffer as ArrayBuffer,
        salt.buffer as ArrayBuffer,
      ];

      // Speed calculation state. The speed is the average over the last SPEED_WINDOW_MS,
      // shown anew every 500 ms, so a short stall or burst does not throw the number around.
      const SPEED_WINDOW_MS = 3000;
      let speedSamples: Array<{ time: number; loaded: number }> = [];
      let lastTime = performance.now();
      let uploadStartTime = 0;
      let uploadTotalBytes = 0;

      // An upload into a request resolves with its ID only.
      const result = await new Promise<{
        id: string;
        ownerToken?: string;
        effectiveSecret?: string;
        hold?: string;
      }>((resolve, reject) => {
        abortRef.current = reject;
        worker.onmessage = (e: MessageEvent<UploadWorkerMessage>) => {
          const msg = e.data;
          switch (msg.type) {
            case "phase":
              // Reset speed tracking on phase change
              speedSamples = [];
              lastTime = performance.now();
              if (msg.phase === "uploading") {
                uploadStartTime = performance.now();
              }
              setState((s) => ({
                ...s,
                phase: msg.phase as UploadPhase,
                progress: 0,
                speed: null,
              }));
              break;
            case "progress": {
              const now = performance.now();
              if (speedSamples.length === 0) speedSamples.push({ time: lastTime, loaded: 0 });
              speedSamples.push({ time: now, loaded: msg.loaded });
              while (speedSamples.length > 2 && now - speedSamples[1]!.time >= SPEED_WINDOW_MS) {
                speedSamples.shift();
              }
              let speed: string | null = null;
              // Update speed every 500ms to avoid flickering
              if (now - lastTime >= 500) {
                const oldest = speedSamples[0]!;
                const bytesPerSec = (msg.loaded - oldest.loaded) / ((now - oldest.time) / 1000);
                speed = `${formatBytes(bytesPerSec)}/s`;
                lastTime = now;
              }
              setState((s) => ({
                ...s,
                progress: Math.min(
                  99,
                  Math.round((msg.loaded / msg.total) * 100),
                ),
                ...(speed ? { speed } : {}),
              }));
              uploadTotalBytes = msg.total;
              break;
            }
            case "done":
              resolve(msg);
              break;
            case "session":
              if (request) requestSessionRef.current = { requestId: request.id, uploadId: msg.id };
              break;
            case "delivered":
              requestSessionRef.current = null;
              resolve({ id: msg.id, hold: msg.hold });
              break;
            case "transport": {
              const event = msg.fallback
                ? { time: new Date().toISOString(), message: "WS failed \u2192 HTTP fallback" }
                : { time: new Date().toISOString(), message: msg.transport === "ws" ? "WebSocket transport active" : "HTTP chunks transport active" };
              setState((s) => ({
                ...s,
                /* v8 ignore next */
                debugInfo: s.debugInfo
                  ? {
                      ...s.debugInfo,
                      transport: msg.transport,
                      fallback: msg.fallback,
                      events: [...s.debugInfo.events, event],
                    }
                  /* v8 ignore next */
                  : null,
              }));
              break;
            }
            case "storage": {
              const event = { time: new Date().toISOString(), message: msg.backend === "s3" ? "S3 upload active" : "Filesystem upload active" };
              setState((s) => ({
                ...s,
                /* v8 ignore next */
                debugInfo: s.debugInfo
                  ? { ...s.debugInfo, storage: msg.backend, events: [...s.debugInfo.events, event] }
                  /* v8 ignore next */
                  : null,
              }));
              break;
            }
            case "error":
              reject(new Error(msg.message));
              break;
          }
        };
        worker.onerror = (e) => {
          reject(new Error(e.message || "Worker error"));
        };

        worker.postMessage(
          {
            file: files.length === 1 ? files[0] : undefined,
            files: files.length > 1 ? files : undefined,
            secret: secret.buffer,
            salt: salt.buffer,
            maxDownloads,
            expireSec,
            password,
            metadata,
            fileCount: files.length,
            apiBase: getApiBase(),
            request: request && {
              id: request.id,
              uploadToken: request.uploadToken,
              publicKey: request.publicKey.slice().buffer,
              ...slot,
            },
          },
          transferable,
        );
      });

      // Worker is done - terminate it
      abortRef.current = null;
      worker.terminate();
      workerRef.current = null;

      // An upload into a request has no link to share and nothing to keep.
      let shareLink: string | null = null;
      if (!request && result.ownerToken && result.effectiveSecret) {
        shareLink = buildShareLink(window.location.origin, "file", result.id, result.effectiveSecret);
        // Store in IndexedDB (main thread - needs DOM)
        await saveUpload({
          id: result.id,
          ownerToken: result.ownerToken,
          secret: result.effectiveSecret,
          fileNames,
          createdAt: new Date().toISOString(),
        });
      }

      // Calculate average upload speed
      let averageSpeed: string | null = null;
      if (uploadStartTime > 0 && uploadTotalBytes > 0) {
        const totalSec = (performance.now() - uploadStartTime) / 1000;
        if (totalSec > 0) {
          averageSpeed = `${formatBytes(uploadTotalBytes / totalSec)}/s`;
        }
      }

      setState((s) => ({
        ...s,
        phase: "done",
        progress: 100,
        speed: null,
        averageSpeed,
        shareLink,
        error: null,
        uploadId: result.id,
        /* v8 ignore next */
        debugInfo: s.debugInfo
          ? {
              ...s.debugInfo,
              events: [
                ...s.debugInfo.events,
                {
                  time: new Date().toISOString(),
                  message: "Upload complete",
                  ...(averageSpeed ? { detail: `Ø ${averageSpeed}` } : {}),
                },
              ],
            }
          /* v8 ignore next */
          : null,
      }));
      return result.hold ? { hold: result.hold } : {};
    } catch (err) {
      abortRef.current = null;
      if (err instanceof UploadCancelled) return null;
      workerRef.current?.terminate();
      workerRef.current = null;
      endRequestSession();
      const message = err instanceof Error ? err.message : "Upload failed";
      setState((s) => ({
        ...s,
        phase: "error",
        error: message,
        debugInfo: s.debugInfo
          ? {
              ...s.debugInfo,
              events: [
                ...s.debugInfo.events,
                {
                  time: new Date().toISOString(),
                  message: "Upload failed",
                  detail: message,
                  failed: true,
                },
              ],
            }
          : null,
      }));
      return null;
    }
  }, [endRequestSession]);

  return { ...state, upload, reset, cancel };
}
