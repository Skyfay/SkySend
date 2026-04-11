import { useState, useCallback, useRef } from "react";
import {
  generateSecret,
  generateSalt,
  calculateEncryptedSize,
  type FileMetadata,
} from "@skysend/crypto";
import { saveUpload } from "@/lib/upload-store";
import { zipFilesAsync } from "@/lib/zip";
import type { UploadWorkerMessage } from "@/lib/upload-worker";
import { formatBytes } from "@/lib/utils";

export type UploadPhase =
  | "idle"
  | "zipping"
  | "uploading"
  | "saving-meta"
  | "done"
  | "error";

interface UploadState {
  phase: UploadPhase;
  progress: number;
  speed: string | null;
  shareLink: string | null;
  error: string | null;
  uploadId: string | null;
}

interface UploadOptions {
  files: File[];
  maxDownloads: number;
  expireSec: number;
  password: string;
}

/**
 * Determine the API base URL.
 * In dev mode (Vite), upload requests go directly to the server
 * to bypass the Vite proxy which doesn't support streaming request bodies.
 * In production, same-origin requests are used (empty string).
 */
function getApiBase(): string {
  if (import.meta.env.DEV) {
    return import.meta.env.VITE_API_BASE ?? "http://localhost:3000";
  }
  return "";
}

export function useUpload() {
  const [state, setState] = useState<UploadState>({
    phase: "idle",
    progress: 0,
    speed: null,
    shareLink: null,
    error: null,
    uploadId: null,
  });
  const workerRef = useRef<Worker | null>(null);

  const reset = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setState({
      phase: "idle",
      progress: 0,
      speed: null,
      shareLink: null,
      error: null,
      uploadId: null,
    });
  }, []);

  const upload = useCallback(async (options: UploadOptions) => {
    const { files, maxDownloads, expireSec, password } = options;

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
      let metadata: FileMetadata;
      const fileNames: string[] = [];

      // Prepare worker payload
      let zipData: ArrayBuffer | undefined;

      if (files.length === 1) {
        const file = files[0]!;
        metadata = {
          type: "single",
          name: file.name,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        };
        fileNames.push(file.name);
      } else {
        // Zip on main thread using fflate's built-in workers
        setState((s) => ({ ...s, phase: "zipping", progress: 0 }));
        const fileEntries = await Promise.all(
          files.map(async (f) => ({
            name: f.webkitRelativePath || f.name,
            data: new Uint8Array(await f.arrayBuffer()),
          })),
        );
        const zipped = await zipFilesAsync(fileEntries);
        zipData = zipped.buffer as ArrayBuffer;
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

      // Spawn upload worker - encryption + upload run off the main thread
      setState((s) => ({ ...s, phase: "uploading", progress: 0, speed: null }));

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
      if (zipData) {
        transferable.push(zipData);
      }

      // Speed calculation state
      let lastLoaded = 0;
      let lastTime = performance.now();

      const plaintextSize = zipData
        ? zipData.byteLength
        : files[0]!.size;
      const encryptedSize = calculateEncryptedSize(plaintextSize);

      const result = await new Promise<{
        id: string;
        ownerToken: string;
        effectiveSecret: string;
      }>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<UploadWorkerMessage>) => {
          const msg = e.data;
          switch (msg.type) {
            case "phase":
              setState((s) => ({ ...s, phase: msg.phase as UploadPhase }));
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
                  Math.round((msg.loaded / encryptedSize) * 100),
                ),
                ...(speed ? { speed } : {}),
              }));
              break;
            }
            case "done":
              resolve(msg);
              break;
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
            zipData,
            secret: secret.buffer,
            salt: salt.buffer,
            maxDownloads,
            expireSec,
            password,
            metadata,
            fileCount: files.length,
            apiBase: getApiBase(),
          },
          transferable,
        );
      });

      // Worker is done - terminate it
      worker.terminate();
      workerRef.current = null;

      // Build share link
      const shareLink = `${window.location.origin}/d/${result.id}#${result.effectiveSecret}`;

      // Store in IndexedDB (main thread - needs DOM)
      await saveUpload({
        id: result.id,
        ownerToken: result.ownerToken,
        secret: result.effectiveSecret,
        fileNames,
        createdAt: new Date().toISOString(),
      });

      setState({
        phase: "done",
        progress: 100,
        speed: null,
        shareLink,
        error: null,
        uploadId: result.id,
      });
    } catch (err) {
      workerRef.current?.terminate();
      workerRef.current = null;
      setState((s) => ({
        ...s,
        phase: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      }));
    }
  }, []);

  return { ...state, upload, reset };
}
