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

export type DownloadPhase =
  | "idle"
  | "loading-info"
  | "needs-password"
  | "verifying-password"
  | "downloading"
  | "decrypting"
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

        setState((s) => ({
          ...s,
          phase: "downloading",
          progress: 0,
          metadata,
          error: null,
        }));

        // Download the encrypted stream
        const { stream, size } = await api.downloadFile(id, authTokenB64);

        // Track progress
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

        // Decrypt
        setState((s) => ({ ...s, phase: "decrypting" }));
        const decryptedStream = progressStream.pipeThrough(
          createDecryptStream(keys.fileKey),
        );

        // Collect decrypted data
        const reader = decryptedStream.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const totalLength = chunks.reduce((s, c) => s + c.byteLength, 0);
        const decrypted = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          decrypted.set(chunk, offset);
          offset += chunk.byteLength;
        }

        // Determine filename and trigger download
        let filename = "download";
        let mimeType = "application/octet-stream";

        if (metadata?.type === "single") {
          filename = metadata.name;
          mimeType = metadata.mimeType;
        } else if (metadata?.type === "archive") {
          filename = "archive.zip";
          mimeType = "application/zip";
        }

        triggerBrowserDownload(decrypted, filename, mimeType);

        setState((s) => ({ ...s, phase: "done", progress: 100 }));
      } catch (err) {
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

function triggerBrowserDownload(
  data: Uint8Array,
  filename: string,
  mimeType: string,
) {
  const blob = new Blob([data as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Cleanup after a short delay to ensure download starts
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}
