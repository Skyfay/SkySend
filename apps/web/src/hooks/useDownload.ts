import { useState, useCallback, useRef } from "react";
import {
  deriveKeys,
  computeAuthToken,
  createDecryptStream,
  decryptMetadata,
  toBase64url,
  fromBase64url,
  applyPasswordProtection,
  deriveKeyFromPassword,
  ARGON2_PARAMS_LEGACY,
  type FileMetadata,
  type Argon2idHashFn,
} from "@skysend/crypto";
import * as api from "@/lib/api";
import { ensureSwController, streamDownloadViaSw } from "@/lib/opfs-download";
import { isSafari, isFirefox, isDevToolsOpen, SAFARI_BIG_SIZE, formatBytes, getBrowserInfo } from "@/lib/utils";

export type DownloadPhase =
  | "idle"
  | "loading-info"
  | "needs-password"
  | "verifying-password"
  | "safari-warning"
  | "firefox-devtools-warning"
  | "downloading"
  | "done"
  | "error";

export interface DownloadDebugInfo {
  tier: "sw" | "file-picker" | "blob" | null;
  swPath: string | null;
  browser: string;
  devtools: boolean;
  fileSize: number | null;
  events: Array<{ time: string; message: string }>;
}

interface DownloadState {
  phase: DownloadPhase;
  progress: number;
  speed: string | null;
  averageSpeed: string | null;
  error: string | null;
  info: api.UploadInfo | null;
  metadata: FileMetadata | null;
  debugInfo: DownloadDebugInfo | null;
  /** Stashed args so Safari warning can resume the download */
  pendingDownloadArgs: { id: string; secretB64: string; password?: string; argon2id?: Argon2idHashFn } | null;
}

export function useDownload() {
  const [state, setState] = useState<DownloadState>({
    phase: "idle",
    progress: 0,
    speed: null,
    averageSpeed: null,
    error: null,
    info: null,
    metadata: null,
    debugInfo: null,
    pendingDownloadArgs: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

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
      /** Skip the Firefox DevTools warning (user chose "download anyway") */
      forceDevTools = false,
    ) => {
      const abortCtrl = new AbortController();
      abortControllerRef.current = abortCtrl;
      try {
        const info = state.info ?? (await api.fetchInfo(id));
        if (!info) throw new Error("Upload not found");

        // Firefox DevTools warning - open DevTools during a download cause lag/freezes.
        // Show before doing any crypto work.
        if (!forceDevTools && isFirefox() && isDevToolsOpen()) {
          setState((s) => ({
            ...s,
            phase: "firefox-devtools-warning",
            info,
            pendingDownloadArgs: { id, secretB64, password, argon2id },
          }));
          return;
        }

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
          const isArgon2 = info.passwordAlgo === "argon2id" || info.passwordAlgo === "argon2id-v2";
          // TODO: Remove "pbkdf2" branch once all pre-v2.4.4 uploads have expired (~ late 2026)
          const { key: passwordKey } = await deriveKeyFromPassword(
            password,
            passwordSalt,
            isArgon2 ? argon2id : undefined,
            // "argon2id" = legacy uploads (pre-v2.4.4) - use old params for backward compat
            info.passwordAlgo === "argon2id" ? ARGON2_PARAMS_LEGACY : undefined,
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
          speed: null,
          metadata,
          error: null,
        }));

        // Speed calculation helper - shared across all download tiers
        let lastLoaded = 0;
        let lastTime = performance.now();
        const updateProgress = (progress: number, loaded: number) => {
          const now = performance.now();
          const elapsed = (now - lastTime) / 1000;
          let speed: string | null = null;
          if (elapsed >= 0.5) {
            const bytesPerSec = (loaded - lastLoaded) / elapsed;
            speed = `${formatBytes(bytesPerSec)}/s`;
            lastLoaded = loaded;
            lastTime = now;
          }
          setState((s) => ({
            ...s,
            progress,
            ...(speed ? { speed } : {}),
          }));
        };

        // ── Safari: skip SW streaming (like Mozilla Send) ──────
        // Safari terminates Service Workers aggressively and buffers
        // ReadableStream responses in RAM instead of streaming to disk.
        // For files > 256 MB we show a warning first (handled by caller).
        const safari = isSafari();
        const downloadStartTime = performance.now();

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

            const tier1DebugInfo: DownloadDebugInfo = {
              tier: "sw",
              swPath: null,
              browser: getBrowserInfo(),
              devtools: isDevToolsOpen(),
              fileSize: info.size,
              events: [{ time: new Date().toISOString(), message: "SW stream started" }],
            };
            setState((s) => ({ ...s, debugInfo: tier1DebugInfo }));

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
              (progress) => {
                const loaded = Math.round((progress / 100) * info.size);
                updateProgress(progress, loaded);
              },
              (swPath) => {
                setState((s) => ({
                  ...s,
                  debugInfo: s.debugInfo
                    ? { ...s.debugInfo, swPath }
                    : null,
                }));
              },
              abortCtrl.signal,
              () => {
                setState((s) => ({
                  ...s,
                  debugInfo: s.debugInfo
                    ? { ...s.debugInfo, events: [...s.debugInfo.events, { time: new Date().toISOString(), message: "S3 presigned URL received" }] }
                    : null,
                }));
              },
            );
            downloaded = true;
          }
        } catch (swErr) {
          // User-initiated cancel - do not fall through to Tier 2/3
          if (swErr instanceof DOMException && swErr.name === "AbortError") throw swErr;
          console.warn("[SkySend] SW stream failed, trying fallback:", swErr);
        }

        // Tier 2: showSaveFilePicker fallback (Chrome, Edge - if SW failed)
        if (!downloaded && typeof window.showSaveFilePicker === "function") {
          try {
            console.info("[SkySend] Download tier: 2 (showSaveFilePicker)");
            setState((s) => ({ ...s, progress: 0 }));
            setState((s) => ({
              ...s,
              debugInfo: {
                tier: "file-picker",
                swPath: null,
                browser: getBrowserInfo(),
                devtools: isDevToolsOpen(),
                fileSize: info.size,
                events: [
                  ...(s.debugInfo?.events ?? []),
                  { time: new Date().toISOString(), message: "Save File Picker started" },
                ],
              },
            }));
            const fileHandle = await window.showSaveFilePicker({
              suggestedName: filename,
              types: mimeType !== "application/octet-stream"
                ? [{ accept: { [mimeType]: [] } }]
                : undefined,
            });
            const writable = await fileHandle.createWritable();

            const { stream, size, storageBackend } = await api.downloadFile(id, authTokenB64);
            if (storageBackend === "s3") {
              setState((s) => ({
                ...s,
                debugInfo: s.debugInfo
                  ? { ...s.debugInfo, events: [...s.debugInfo.events, { time: new Date().toISOString(), message: "S3 presigned URL received" }] }
                  : null,
              }));
            }

            let loaded = 0;
            let tier2StallTimer: ReturnType<typeof setTimeout> | null = null;
            let tier2StallFired = false;
            const resetTier2Stall = () => {
              if (tier2StallFired) {
                setState((s) => ({
                  ...s,
                  debugInfo: s.debugInfo
                    ? { ...s.debugInfo, events: [...s.debugInfo.events, { time: new Date().toISOString(), message: "Download resumed" }] }
                    : null,
                }));
                tier2StallFired = false;
              }
              if (tier2StallTimer) clearTimeout(tier2StallTimer);
              tier2StallTimer = setTimeout(() => {
                tier2StallFired = true;
                const pct = size > 0 ? Math.round((loaded / size) * 100) : 0;
                setState((s) => ({
                  ...s,
                  debugInfo: s.debugInfo
                    ? { ...s.debugInfo, events: [...s.debugInfo.events, { time: new Date().toISOString(), message: `Download stalled at ${pct}%` }] }
                    : null,
                }));
              }, 5000);
            };
            resetTier2Stall();

            const progressStream = stream.pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                  loaded += chunk.byteLength;
                  const pct = size > 0 ? Math.round((loaded / size) * 100) : 0;
                  updateProgress(pct, loaded);
                  resetTier2Stall();
                  controller.enqueue(chunk);
                },
              }),
            );

            await progressStream
              .pipeThrough(createDecryptStream(keys.fileKey))
              .pipeTo(writable, { signal: abortCtrl.signal });
            if (tier2StallTimer) clearTimeout(tier2StallTimer);
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
          setState((s) => ({ ...s, progress: 0 }));
          setState((s) => ({
            ...s,
            debugInfo: {
              tier: "blob",
              swPath: null,
              browser: getBrowserInfo(),
              devtools: isDevToolsOpen(),
              fileSize: info.size,
              events: [
                ...(s.debugInfo?.events ?? []),
                { time: new Date().toISOString(), message: `Blob fallback started${safari ? " (Safari)" : ""}` },
              ],
            },
          }));
          const { stream, size, storageBackend } = await api.downloadFile(id, authTokenB64);
          if (storageBackend === "s3") {
            setState((s) => ({
              ...s,
              debugInfo: s.debugInfo
                ? { ...s.debugInfo, events: [...s.debugInfo.events, { time: new Date().toISOString(), message: "S3 presigned URL received" }] }
                : null,
            }));
          }

          let loaded = 0;
          let blobStallTimer: ReturnType<typeof setTimeout> | null = null;
          let blobStallFired = false;
          const resetBlobStall = () => {
            if (blobStallFired) {
              setState((s) => ({
                ...s,
                debugInfo: s.debugInfo
                  ? { ...s.debugInfo, events: [...s.debugInfo.events, { time: new Date().toISOString(), message: "Download resumed" }] }
                  : null,
              }));
              blobStallFired = false;
            }
            if (blobStallTimer) clearTimeout(blobStallTimer);
            blobStallTimer = setTimeout(() => {
              blobStallFired = true;
              const pct = size > 0 ? Math.round((loaded / size) * 100) : 0;
              setState((s) => ({
                ...s,
                debugInfo: s.debugInfo
                  ? { ...s.debugInfo, events: [...s.debugInfo.events, { time: new Date().toISOString(), message: `Download stalled at ${pct}%` }] }
                  : null,
              }));
            }, 5000);
          };
          resetBlobStall();

          const progressStream = stream.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                loaded += chunk.byteLength;
                const pct = size > 0 ? Math.round((loaded / size) * 100) : 0;
                updateProgress(pct, loaded);
                resetBlobStall();
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
            if (abortCtrl.signal.aborted) {
              reader.cancel();
              throw new DOMException("Download cancelled by user", "AbortError");
            }
            chunks.push(value);
          }
          if (blobStallTimer) clearTimeout(blobStallTimer);
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

        let averageSpeed: string | null = null;
        if (info.size > 0) {
          const totalSec = (performance.now() - downloadStartTime) / 1000;
          if (totalSec > 0) {
            averageSpeed = `${formatBytes(info.size / totalSec)}/s`;
          }
        }

        setState((s) => ({
          ...s,
          phase: "done",
          progress: 100,
          averageSpeed,
          debugInfo: s.debugInfo
            ? { ...s.debugInfo, events: [...s.debugInfo.events, { time: new Date().toISOString(), message: averageSpeed ? `Download complete · Ø ${averageSpeed}` : "Download complete" }] }
            : null,
        }));
      } catch (err) {
        abortControllerRef.current = null;
        // User cancelled (save dialog, cancel button, etc.) - not an error
        if (err instanceof DOMException && err.name === "AbortError") {
          setState((s) => ({ ...s, phase: "idle" }));
          return;
        }
        if (err instanceof api.ApiError && err.status === 429) {
          setState((s) => ({ ...s, phase: "needs-password", error: "rate-limited" }));
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
      speed: null,
      averageSpeed: null,
      error: null,
      info: null,
      metadata: null,
      debugInfo: null,
      pendingDownloadArgs: null,
    });
  }, []);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
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

  /** User closed DevTools and wants to retry - re-runs all checks fresh */
  const retryDevToolsCheck = useCallback(() => {
    const args = state.pendingDownloadArgs;
    if (!args) return;
    setState((s) => ({ ...s, pendingDownloadArgs: null }));
    download(args.id, args.secretB64, args.password, args.argon2id);
  }, [state.pendingDownloadArgs, download]);

  /** User chose "Download anyway" on the Firefox DevTools warning (false-positive escape hatch) */
  const forceDownloadWithDevTools = useCallback(() => {
    const args = state.pendingDownloadArgs;
    if (!args) return;
    setState((s) => ({ ...s, pendingDownloadArgs: null }));
    download(args.id, args.secretB64, args.password, args.argon2id, false, true);
  }, [state.pendingDownloadArgs, download]);

  /** User dismissed the Firefox DevTools warning */
  const dismissDevToolsWarning = useCallback(() => {
    setState((s) => ({ ...s, phase: "idle", pendingDownloadArgs: null }));
  }, []);

  return {
    ...state,
    loadInfo,
    download,
    cancel,
    reset,
    confirmSafariDownload,
    dismissSafariWarning,
    retryDevToolsCheck,
    forceDownloadWithDevTools,
    dismissDevToolsWarning,
  };
}
