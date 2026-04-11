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

        setState((s) => ({
          ...s,
          phase: "downloading",
          progress: 0,
          metadata,
          error: null,
        }));

        // ── Download Strategy (ordered by preference) ──────────
        // Tier 1: SW stream - fastest, works in all modern browsers
        // Tier 2: showSaveFilePicker - zero RAM fallback (Chrome, Edge)
        // Tier 3: Blob - last resort (uses full file size in RAM)
        let downloaded = false;

        // Tier 1: Service Worker streaming decryption (primary for ALL browsers)
        try {
          const sw = await ensureSwController();
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

        // Tier 3: Blob fallback (uses RAM - last resort)
        if (!downloaded) {
          console.warn("[SkySend] Download tier: 3 (Blob fallback - large files will use RAM)");
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
    });
  }, []);

  return { ...state, loadInfo, download, reset };
}
