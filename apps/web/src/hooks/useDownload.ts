import { useState, useCallback } from "react";
import {
  deriveKeys,
  computeAuthToken,
  createDecryptStream,
  decryptMetadata,
  toBase64url,
  fromBase64url,
  applyPasswordProtection,
  deriveKeyFromPassword,
  type FileMetadata,
  type Argon2idHashFn,
} from "@skysend/crypto";
import * as api from "@/lib/api";
import { checkOpfsSupport, startOpfsDownload, triggerSwDownload, triggerBlobDownload, ensureSwController, streamDownloadViaSw } from "@/lib/opfs-download";

export type DownloadPhase =
  | "idle"
  | "loading-info"
  | "needs-password"
  | "verifying-password"
  | "downloading"
  | "done"
  | "error";

interface DownloadState {
  phase: DownloadPhase;
  progress: number;
  error: string | null;
  info: api.UploadInfo | null;
  metadata: FileMetadata | null;
}

export function useDownload() {
  const [state, setState] = useState<DownloadState>({
    phase: "idle",
    progress: 0,
    error: null,
    info: null,
    metadata: null,
  });

  const loadInfo = useCallback(async (id: string) => {
    try {
      setState((s) => ({ ...s, phase: "loading-info", error: null }));
      const info = await api.fetchInfo(id);
      const nextPhase = info.hasPassword ? "needs-password" : "idle";
      setState((s) => ({ ...s, phase: nextPhase, info }));
      return info;
    } catch (err) {
      const message = err instanceof api.ApiError
        ? err.message
        : "Failed to load upload info";
      setState((s) => ({ ...s, phase: "error", error: message }));
      return null;
    }
  }, []);

  const download = useCallback(
    async (
      id: string,
      secretB64: string,
      password?: string,
      argon2id?: Argon2idHashFn,
    ) => {
      try {
        const info = state.info ?? (await api.fetchInfo(id));
        if (!info) throw new Error("Upload not found");

        let secret = fromBase64url(secretB64);
        const salt = fromBase64url(info.salt);

        // Handle password protection
        if (info.hasPassword && password) {
          setState((s) => ({ ...s, phase: "verifying-password" }));
          if (!info.passwordSalt) throw new Error("Missing password salt");

          const passwordSalt = fromBase64url(info.passwordSalt);
          const { key: passwordKey } = await deriveKeyFromPassword(
            password,
            passwordSalt,
            info.passwordAlgo === "argon2id" ? argon2id : undefined,
          );
          secret = applyPasswordProtection(secret, passwordKey);
        }

        // Derive keys from (possibly password-recovered) secret
        const keys = await deriveKeys(secret, salt);
        const authToken = await computeAuthToken(keys.authKey);
        const authTokenB64 = toBase64url(authToken);

        // Verify password if protected
        if (info.hasPassword) {
          const valid = await api.verifyPassword(id, authTokenB64);
          if (!valid) {
            setState((s) => ({
              ...s,
              phase: "needs-password",
              error: "wrong-password",
            }));
            return;
          }
        }

        // Decrypt metadata if available
        let metadata: FileMetadata | null = null;
        if (info.encryptedMeta && info.nonce) {
          const metaCiphertext = Uint8Array.from(atob(info.encryptedMeta), (c) =>
            c.charCodeAt(0),
          );
          const metaNonce = Uint8Array.from(atob(info.nonce), (c) =>
            c.charCodeAt(0),
          );
          metadata = await decryptMetadata(metaCiphertext, metaNonce, keys.metaKey);
        }

        // Determine filename and mime type early (needed for save dialog)
        let filename = "download";
        let mimeType = "application/octet-stream";
        if (metadata?.type === "single") {
          filename = metadata.name;
          mimeType = metadata.mimeType;
        } else if (metadata?.type === "archive") {
          filename = "archive.zip";
          mimeType = "application/zip";
        }

        const supportsFilePicker = typeof window.showSaveFilePicker === "function";

        // Detect download strategy BEFORE starting the download.
        let writable: FileSystemWritableFileStream | null = null;
        let useOpfs = false;

        if (supportsFilePicker) {
          // Tier 1: showSaveFilePicker - zero RAM (Chrome, Edge)
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: mimeType !== "application/octet-stream"
              ? [{ accept: { [mimeType]: [] } }]
              : undefined,
          });
          writable = await fileHandle.createWritable();
        } else {
          // Tier 2 probe: test OPFS + createSyncAccessHandle in Worker (cached)
          useOpfs = await checkOpfsSupport();
        }

        setState((s) => ({
          ...s,
          phase: "downloading",
          progress: 0,
          metadata,
          error: null,
        }));

        // Log which download strategy is being used
        const tier = writable ? "1 (showSaveFilePicker)" : useOpfs ? "2 (OPFS Worker)" : "2/3 (SW stream or Blob)";
        console.info(`[SkySend] Download tier: ${tier}`);

        if (writable) {
          // Tier 1: showSaveFilePicker - zero RAM (Chrome, Edge)
          // fetch + decrypt on main thread, pipe directly to file
          const { stream, size } = await api.downloadFile(id, authTokenB64);

          let loaded = 0;
          const progressStream = stream.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                loaded += chunk.byteLength;
                setState((s) => ({
                  ...s,
                  progress: size > 0 ? Math.round((loaded / size) * 100) : 0,
                }));
                controller.enqueue(chunk);
              },
            }),
          );

          await progressStream
            .pipeThrough(createDecryptStream(keys.fileKey))
            .pipeTo(writable);
        } else if (useOpfs) {
          // Tier 2: ALL-IN-WORKER + Service Worker streaming.
          // Step 1: Worker does fetch → decrypt → OPFS write (zero main thread data)
          // Step 2: Service Worker streams from OPFS to native download manager (zero RAM)
          try {
            const apiBase = import.meta.env.DEV
              ? (import.meta.env.VITE_API_BASE ?? "http://localhost:3000")
              : window.location.origin;
            const downloadUrl = `${apiBase}/api/download/${id}`;

            // Pass raw secret + salt to Worker (it derives keys internally)
            const secretBuf = secret.buffer.slice(
              secret.byteOffset,
              secret.byteOffset + secret.byteLength,
            ) as ArrayBuffer;
            const saltBuf = salt.buffer.slice(
              salt.byteOffset,
              salt.byteOffset + salt.byteLength,
            ) as ArrayBuffer;
            const tempName = `skysend-${crypto.randomUUID()}`;

            const { cleanup } = await startOpfsDownload(
              downloadUrl,
              authTokenB64,
              secretBuf,
              saltBuf,
              tempName,
              info.size,
              (progress) => setState((s) => ({ ...s, progress })),
            );

            // Step 2: Trigger download via Service Worker (zero RAM) or Blob URL (fallback)
            try {
              if (navigator.serviceWorker?.controller) {
                console.info("[SkySend] Triggering download via Service Worker");
                await triggerSwDownload(tempName, filename, mimeType);
              } else {
                console.info("[SkySend] SW not ready, using OPFS blob fallback");
                await triggerBlobDownload(tempName, filename, mimeType);
              }
            } catch (triggerErr) {
              console.warn("[SkySend] SW trigger failed, using blob fallback:", triggerErr);
              await triggerBlobDownload(tempName, filename, mimeType);
            }

            setTimeout(cleanup, 120_000);
          } catch (opfsErr) {
            console.warn("[SkySend] OPFS tier failed, falling back to Blob:", opfsErr);
            useOpfs = false; // fall through to Blob below
          }
        }

        if (!writable && !useOpfs) {
          // Tier 2b: SW stream (Firefox/Safari) - no OPFS needed
          // Falls back to Tier 3 (Blob) if SW is not available
          let streamed = false;
          try {
            const sw = await ensureSwController();
            if (sw) {
              console.info("[SkySend] Download tier: 2 (SW stream)");

              const apiBase = import.meta.env.DEV
                ? (import.meta.env.VITE_API_BASE ?? "http://localhost:3000")
                : window.location.origin;
              const downloadUrl = `${apiBase}/api/download/${id}`;

              const secretBuf = secret.buffer.slice(
                secret.byteOffset,
                secret.byteOffset + secret.byteLength,
              ) as ArrayBuffer;
              const saltBuf = salt.buffer.slice(
                salt.byteOffset,
                salt.byteOffset + salt.byteLength,
              ) as ArrayBuffer;

              await streamDownloadViaSw(
                downloadUrl,
                authTokenB64,
                secretBuf,
                saltBuf,
                filename,
                mimeType,
                info.size,
                (progress) => setState((s) => ({ ...s, progress })),
              );
              streamed = true;
            }
          } catch (swErr) {
            console.warn("[SkySend] SW stream failed, falling back to Blob:", swErr);
          }

          if (!streamed) {
            // Tier 3: Blob fallback - uses RAM
            console.warn("[SkySend] Using Blob fallback - large files will use RAM");
            const { stream, size } = await api.downloadFile(id, authTokenB64);

            let loaded = 0;
            const progressStream = stream.pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                  loaded += chunk.byteLength;
                  setState((s) => ({
                    ...s,
                    progress: size > 0 ? Math.round((loaded / size) * 100) : 0,
                  }));
                  controller.enqueue(chunk);
                },
              }),
            );

            const decryptedStream = progressStream.pipeThrough(
              createDecryptStream(keys.fileKey),
            );

            const reader = decryptedStream.getReader();
            const chunks: Uint8Array[] = [];
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            const blob = new Blob(chunks as BlobPart[], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }
        }

        setState((s) => ({ ...s, phase: "done", progress: 100 }));
      } catch (err) {
        // User cancelled the save dialog - not an error
        if (err instanceof DOMException && err.name === "AbortError") {
          setState((s) => ({ ...s, phase: "idle" }));
          return;
        }
        const message = err instanceof api.ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Download failed";
        setState((s) => ({ ...s, phase: "error", error: message }));
      }
    },
    [state.info],
  );

  const reset = useCallback(() => {
    setState({
      phase: "idle",
      progress: 0,
      error: null,
      info: null,
      metadata: null,
    });
  }, []);

  return { ...state, loadInfo, download, reset };
}
