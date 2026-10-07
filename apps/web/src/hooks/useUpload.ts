import { useState, useCallback, useRef } from "react";
import {
  generateSecret,
  generateSalt,
  type RequestUploadMetadata,
} from "@skysend/crypto";
import { saveUpload } from "@/lib/upload-store";
import type { UploadWorkerMessage } from "@/lib/upload-worker";
import { formatBytes, getBrowserInfo } from "@/lib/utils";

export type UploadPhase =
  | "idle"
  | "zipping"
  | "uploading"
  | "saving-meta"
  | "done"
  | "error";

export interface UploadDebugInfo {
  transport: "ws" | "http" | null;
  fallback: boolean;
  browser: string;
  events: Array<{ time: string; message: string }>;
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
  request: { id: string; uploadToken: string; publicKey: Uint8Array };
}

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
  /** The open session of an upload into a request, so a cancel can give its slot back. */
  const requestSessionRef = useRef<{ requestId: string; uploadId: string } | null>(null);

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
    workerRef.current?.terminate();
    workerRef.current = null;
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

  const upload = useCallback(async (options: UploadOptions) => {
    const { request } = options;
    const note = request ? options.note : undefined;
    // A note travels like a single file, with metadata that names it a note.
    const files = note === undefined ? options.files : [new File([note], "note")];
    const maxDownloads = request ? 0 : options.maxDownloads;
    const expireSec = request ? 0 : options.expireSec;
    const password = request ? "" : options.password;

    try {
      // Pre-flight: verify all files are still readable
      for (const file of files) {
        try {
          await file.slice(0, 1).arrayBuffer();
        } catch {
          throw new Error("fileNotReadable");
        }
      }

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
        metadata = {
          type: "archive",
          files: files.map((f) => ({
            name: f.webkitRelativePath || f.name,
            size: f.size,
          })),
          totalSize: files.reduce((sum, f) => sum + f.size, 0),
        };
        for (const f of files) {
          fileNames.push(f.webkitRelativePath || f.name);
        }
      }

      // Spawn upload worker - zipping (if multi-file), encryption + upload
      // all run off the main thread.
      setState((s) => ({
        ...s,
        phase: files.length > 1 ? "zipping" : "uploading",
        progress: 0,
        speed: null,
        debugInfo: {
          transport: null,
          fallback: false,
          browser: getBrowserInfo(),
          events: [],
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

      // Speed calculation state
      let lastLoaded = 0;
      let lastTime = performance.now();
      let uploadStartTime = 0;
      let uploadTotalBytes = 0;

      // An upload into a request resolves with its ID only.
      const result = await new Promise<{
        id: string;
        ownerToken?: string;
        effectiveSecret?: string;
      }>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<UploadWorkerMessage>) => {
          const msg = e.data;
          switch (msg.type) {
            case "phase":
              // Reset speed tracking on phase change
              lastLoaded = 0;
              lastTime = performance.now();
              if (msg.phase === "uploading") {
                uploadStartTime = performance.now();
              }
              if (msg.phase === "zipping") {
                setState((s) => ({
                  ...s,
                  phase: msg.phase as UploadPhase,
                  progress: 0,
                  speed: null,
                  /* v8 ignore next */
                  debugInfo: s.debugInfo
                    ? { ...s.debugInfo, events: [...s.debugInfo.events, { time: new Date().toISOString(), message: "Packing started" }] }
                    /* v8 ignore next */
                    : null,
                }));
              } else {
                setState((s) => ({ ...s, phase: msg.phase as UploadPhase, progress: 0, speed: null }));
              }
              break;
            case "progress": {
              const now = performance.now();
              const elapsed = (now - lastTime) / 1000;
              let speed: string | null = null;
              // Update speed every 500ms to avoid flickering
              if (elapsed >= 0.5) {
                const bytesPerSec = (msg.loaded - lastLoaded) / elapsed;
                speed = `${formatBytes(bytesPerSec)}/s`;
                lastLoaded = msg.loaded;
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
            case "pack-done": {
              const avgPackSpeed = msg.durationMs > 0
                ? `${formatBytes(Math.round(msg.inputBytes / (msg.durationMs / 1000)))}/s`
                : null;
              const packEvent = { time: new Date().toISOString(), message: avgPackSpeed ? `Packing complete \u00b7 \u00d8 ${avgPackSpeed}` : "Packing complete" };
              setState((s) => ({
                ...s,
                /* v8 ignore next */
                debugInfo: s.debugInfo
                  ? { ...s.debugInfo, events: [...s.debugInfo.events, packEvent] }
                  /* v8 ignore next */
                  : null,
              }));
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
              resolve({ id: msg.id });
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
                  ? { ...s.debugInfo, events: [...s.debugInfo.events, event] }
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
            },
          },
          transferable,
        );
      });

      // Worker is done - terminate it
      worker.terminate();
      workerRef.current = null;

      // An upload into a request has no link to share and nothing to keep.
      let shareLink: string | null = null;
      if (!request && result.ownerToken && result.effectiveSecret) {
        shareLink = `${window.location.origin}/file/${result.id}#${result.effectiveSecret}`;
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
          ? { ...s.debugInfo, events: [...s.debugInfo.events, { time: new Date().toISOString(), message: averageSpeed ? `Upload complete · Ø ${averageSpeed}` : "Upload complete" }] }
          /* v8 ignore next */
          : null,
      }));
    } catch (err) {
      workerRef.current?.terminate();
      workerRef.current = null;
      endRequestSession();
      setState((s) => ({
        ...s,
        phase: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      }));
    }
  }, [endRequestSession]);

  return { ...state, upload, reset, cancel };
}
