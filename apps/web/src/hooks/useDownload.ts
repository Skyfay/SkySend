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

        // If File System Access API is available, prompt user first
        // so we can stream directly to disk with zero RAM usage.
        let writable: FileSystemWritableFileStream | null = null;
        if (supportsFilePicker) {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: mimeType !== "application/octet-stream"
              ? [{ accept: { [mimeType]: [] } }]
              : undefined,
          });
          writable = await fileHandle.createWritable();
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

        // Pipeline: network -> progress tracking -> decrypt
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

        if (writable) {
          // Tier 1: showSaveFilePicker - zero RAM (Chrome, Edge)
          await decryptedStream.pipeTo(writable);
        } else {
          // Tier 2: Try OPFS - stream to temp file on disk, then trigger download.
          // Zero RAM during decrypt. Falls back to Blob if OPFS is unavailable
          // (e.g. Firefox SecurityError, older browsers).
          let usedOpfs = false;

          if (typeof navigator?.storage?.getDirectory === "function") {
            try {
              const opfsRoot = await navigator.storage.getDirectory();
              const tempName = `skysend-${crypto.randomUUID()}`;
              const tempHandle = await opfsRoot.getFileHandle(tempName, { create: true });
              const opfsWritable = await tempHandle.createWritable();

              await decryptedStream.pipeTo(opfsWritable);

              // getFile() returns a disk-backed File reference (no RAM copy)
              const file = await tempHandle.getFile();
              const url = URL.createObjectURL(file);
              const a = document.createElement("a");
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              a.remove();

              // Clean up after the browser has read the file.
              // The File object stays valid as long as the objectURL exists,
              // so we must revoke the URL first, then delete the OPFS entry.
              setTimeout(async () => {
                URL.revokeObjectURL(url);
                await opfsRoot.removeEntry(tempName).catch(() => {});
              }, 120_000);

              usedOpfs = true;
            } catch {
              // OPFS failed (SecurityError in Firefox, etc.) - fall through to Blob
            }
          }

          if (!usedOpfs) {
            // Tier 3: Blob fallback - uses RAM (Firefox, ancient browsers)
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
