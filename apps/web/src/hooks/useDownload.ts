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
import { ensureSwController, streamDownloadViaSw } from "@/lib/opfs-download";
import { isSafari, SAFARI_BIG_SIZE } from "@/lib/utils";

export type DownloadPhase =
  | "idle"
  | "loading-info"
  | "needs-password"
  | "verifying-password"
  | "safari-warning"
  | "downloading"
  | "done"
  | "error";

interface DownloadState {
  phase: DownloadPhase;
  progress: number;
  error: string | null;
  info: api.UploadInfo | null;
  metadata: FileMetadata | null;
  /** Stashed args so Safari warning can resume the download */
  pendingDownloadArgs: { id: string; secretB64: string; password?: string; argon2id?: Argon2idHashFn } | null;
}

export function useDownload() {
  const [state, setState] = useState<DownloadState>({
    phase: "idle",
    progress: 0,
    error: null,
    info: null,
    metadata: null,
    pendingDownloadArgs: null,
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
      /** Skip the Safari large-file warning (user chose "continue anyway") */
      forceSafari = false,
    ) => {
      try {
        const info = state.info ?? (await api.fetchInfo(id));
        if (!info) throw new Error("Upload not found");

        // Safari large-file warning (like Mozilla Send's noStreams warning).
        // Show before doing any crypto work.
        if (!forceSafari && isSafari() && info.size > SAFARI_BIG_SIZE) {
          setState((s) => ({
            ...s,
            phase: "safari-warning",
            info,
            pendingDownloadArgs: { id, secretB64, password, argon2id },
          }));
          return;
        }

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

        setState((s) => ({
          ...s,
          phase: "downloading",
          progress: 0,
          metadata,
          error: null,
        }));

        // ── Safari: skip SW streaming (like Mozilla Send) ──────
        // Safari terminates Service Workers aggressively and buffers
        // ReadableStream responses in RAM instead of streaming to disk.
        // For files > 256 MB we show a warning first (handled by caller).
        const safari = isSafari();

        // ── Download Strategy (ordered by preference) ──────────
        // Tier 1: SW stream - fastest (Chrome, Edge, Brave, Firefox)
        // Tier 2: showSaveFilePicker - zero RAM fallback (Chrome, Edge)
        // Tier 3: Blob - last resort / Safari default (uses full file size in RAM)
        let downloaded = false;

        // Tier 1: Service Worker streaming decryption (non-Safari browsers)
        try {
          const sw = !safari ? await ensureSwController() : null;
          if (sw) {
            console.info("[SkySend] Download tier: 1 (SW stream)");

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
            downloaded = true;
          }
        } catch (swErr) {
          console.warn("[SkySend] SW stream failed, trying fallback:", swErr);
        }

        // Tier 2: showSaveFilePicker fallback (Chrome, Edge - if SW failed)
        if (!downloaded && typeof window.showSaveFilePicker === "function") {
          try {
            console.info("[SkySend] Download tier: 2 (showSaveFilePicker)");
            const fileHandle = await window.showSaveFilePicker({
              suggestedName: filename,
              types: mimeType !== "application/octet-stream"
                ? [{ accept: { [mimeType]: [] } }]
                : undefined,
            });
            const writable = await fileHandle.createWritable();

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
            downloaded = true;
          } catch (pickerErr) {
            // User cancelled = AbortError, rethrow to be caught by outer handler
            if (pickerErr instanceof DOMException && pickerErr.name === "AbortError") {
              throw pickerErr;
            }
            console.warn("[SkySend] showSaveFilePicker failed:", pickerErr);
          }
        }

        // Tier 3: Blob fallback (uses RAM - last resort / Safari default)
        if (!downloaded) {
          console.warn(`[SkySend] Download tier: 3 (Blob fallback${safari ? " - Safari" : ""})`);
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
      pendingDownloadArgs: null,
    });
  }, []);

  /** User chose "Continue anyway" on the Safari large-file warning */
  const confirmSafariDownload = useCallback(() => {
    const args = state.pendingDownloadArgs;
    if (!args) return;
    setState((s) => ({ ...s, pendingDownloadArgs: null }));
    download(args.id, args.secretB64, args.password, args.argon2id, true);
  }, [state.pendingDownloadArgs, download]);

  /** User dismissed the Safari warning */
  const dismissSafariWarning = useCallback(() => {
    setState((s) => ({ ...s, phase: "idle", pendingDownloadArgs: null }));
  }, []);

  return { ...state, loadInfo, download, reset, confirmSafariDownload, dismissSafariWarning };
}
