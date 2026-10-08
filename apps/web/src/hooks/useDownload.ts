import { useState, useCallback, useRef } from "react";
import {
  deriveKeys,
  computeAuthToken,
  decryptMetadata,
  expectedPlaintextSize,
  toBase64url,
  fromBase64url,
  applyPasswordProtection,
  deriveKeyFromPassword,
  type DerivedKeys,
  type FileMetadata,
  type Argon2idHashFn,
} from "@skysend/crypto";
import * as api from "@/lib/api";
import { saveDecryptedDownload, type DownloadDebugInfo } from "@/lib/download-tiers";
import { isSafari, isFirefox, isDevToolsOpen, SAFARI_BIG_SIZE, formatBytes } from "@/lib/utils";

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

export type { DownloadDebugInfo };

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

interface PreparedDownload {
  secret: Uint8Array;
  salt: Uint8Array;
  keys: DerivedKeys;
  authTokenB64: string;
}

/** Derives the file, metadata, and auth keys from an already recovered secret. */
async function deriveFromSecret(
  secret: Uint8Array,
  saltB64: string,
): Promise<PreparedDownload> {
  const salt = fromBase64url(saltB64);
  const keys = await deriveKeys(secret, salt);
  const authToken = await computeAuthToken(keys.authKey);
  return { secret, salt, keys, authTokenB64: toBase64url(authToken) };
}

/**
 * Recovers the secret from the URL fragment - unwrapping the password protection
 * when one is set - and derives the download keys from it.
 */
async function prepareKeys(
  secretB64: string,
  saltB64: string,
  password?: string,
  passwordSaltB64?: string,
  argon2id?: Argon2idHashFn,
): Promise<PreparedDownload> {
  let secret = fromBase64url(secretB64);

  if (password) {
    if (!passwordSaltB64) throw new Error("Missing password salt");
    /* v8 ignore next */
    if (!argon2id) throw new Error("Argon2id is required to decrypt password-protected uploads");

    const passwordSalt = fromBase64url(passwordSaltB64);
    const { key: passwordKey } = await deriveKeyFromPassword(
      password,
      passwordSalt,
      argon2id,
    );
    secret = applyPasswordProtection(secret, passwordKey);
  }

  return deriveFromSecret(secret, saltB64);
}

/**
 * The info with the metadata a password check released. GET /api/info holds it back for a
 * password-protected upload, so it arrives with a correct password only.
 */
function withUnlockedMeta(info: api.UploadInfo, unlocked: api.UnlockedMeta): api.UploadInfo {
  return {
    ...info,
    encryptedMeta: unlocked.encryptedMeta ?? info.encryptedMeta,
    nonce: unlocked.nonce ?? info.nonce,
  };
}

/** Decrypts the upload metadata. Returns null for uploads that carry none. */
async function decryptMeta(
  info: api.UploadInfo,
  metaKey: CryptoKey,
): Promise<FileMetadata | null> {
  if (!info.encryptedMeta || !info.nonce) return null;

  const ciphertext = Uint8Array.from(atob(info.encryptedMeta), (c) =>
    c.charCodeAt(0),
  );
  const nonce = Uint8Array.from(atob(info.nonce), (c) => c.charCodeAt(0));
  return decryptMetadata(ciphertext, nonce, metaKey);
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
  /**
   * Secret recovered by a successful unlock(). Caching it lets the download skip
   * a second Argon2id run and a redundant password verification round-trip.
   */
  const unlockedSecretRef = useRef<Uint8Array | null>(null);

  const loadInfo = useCallback(async (id: string, secretB64?: string) => {
    try {
      setState((s) => ({ ...s, phase: "loading-info", error: null }));
      const info = await api.fetchInfo(id);

      if (info.hasPassword || !secretB64) {
        const nextPhase = info.hasPassword ? "needs-password" : "idle";
        setState((s) => ({ ...s, phase: nextPhase, info }));
        return info;
      }

      // Without a password the metadata key is available immediately, so the
      // recipient can see what the link holds without spending a download.
      let metadata: FileMetadata | null = null;
      try {
        const { keys } = await deriveFromSecret(fromBase64url(secretB64), info.salt);
        metadata = await decryptMeta(info, keys.metaKey);
      } catch (err) {
        // A broken fragment or corrupted metadata must not block the page - the
        // download itself surfaces the real error.
        console.warn("[SkySend] Could not decrypt metadata on load:", err);
      }

      setState((s) => ({ ...s, phase: "idle", info, metadata }));
      return info;
    } catch (err) {
      const message = err instanceof api.ApiError
        ? err.message
        : "Failed to load upload info";
      setState((s) => ({ ...s, phase: "error", error: message }));
      return null;
    }
  }, []);

  /**
   * Verifies the password and decrypts the metadata without starting the
   * transfer. Verification is free - only GET /api/download consumes a download.
   */
  const unlock = useCallback(
    async (
      id: string,
      secretB64: string,
      password: string,
      argon2id: Argon2idHashFn,
    ) => {
      try {
        let info = state.info ?? (await api.fetchInfo(id));
        // Clearing the error lets PasswordPrompt toast again on a repeated failure.
        setState((s) => ({ ...s, phase: "verifying-password", info, error: null }));

        const { secret, keys, authTokenB64 } = await prepareKeys(
          secretB64,
          info.salt,
          password,
          info.passwordSalt,
          argon2id,
        );

        const unlocked = await api.verifyPassword(id, authTokenB64);
        if (!unlocked) {
          setState((s) => ({
            ...s,
            phase: "needs-password",
            error: "wrong-password",
          }));
          return;
        }

        unlockedSecretRef.current = secret;
        info = withUnlockedMeta(info, unlocked);

        let metadata: FileMetadata | null = null;
        try {
          metadata = await decryptMeta(info, keys.metaKey);
        } catch (err) {
          console.warn("[SkySend] Could not decrypt metadata after unlock:", err);
        }

        setState((s) => ({ ...s, phase: "idle", info, metadata, error: null }));
      } catch (err) {
        if (err instanceof api.ApiError && err.status === 429) {
          setState((s) => ({ ...s, phase: "needs-password", error: "rate-limited" }));
          return;
        }
        const message = err instanceof api.ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to unlock upload";
        setState((s) => ({ ...s, phase: "error", error: message }));
      }
    },
    [state.info],
  );

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
        let info = state.info ?? (await api.fetchInfo(id));
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

        // A prior unlock() already recovered the secret and verified the password,
        // so both the Argon2id run and the verification round-trip are skipped.
        const unlockedSecret = unlockedSecretRef.current;
        let prepared: PreparedDownload;

        if (unlockedSecret) {
          prepared = await deriveFromSecret(unlockedSecret, info.salt);
        } else {
          if (info.hasPassword && password) {
            setState((s) => ({ ...s, phase: "verifying-password" }));
          }

          prepared = await prepareKeys(
            secretB64,
            info.salt,
            info.hasPassword ? password : undefined,
            info.passwordSalt,
            argon2id,
          );

          // Verify password if protected
          if (info.hasPassword) {
            const unlocked = await api.verifyPassword(id, prepared.authTokenB64);
            if (!unlocked) {
              setState((s) => ({
                ...s,
                phase: "needs-password",
                error: "wrong-password",
              }));
              return;
            }
            info = withUnlockedMeta(info, unlocked);
          }
        }

        const { secret, salt, keys, authTokenB64 } = prepared;

        // Reuse the metadata decrypted during loadInfo()/unlock() when available.
        const metadata = state.metadata ?? (await decryptMeta(info, keys.metaKey));
        // The metadata carries the authenticated size the download is checked against.
        if (!metadata) {
          throw new Error("The upload has no metadata, so the download cannot be verified");
        }
        const plaintextSize = expectedPlaintextSize(metadata);

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

        // Speed calculation helper - shared across all download tiers. A tier that
        // falls back starts again at 0, which also resets the speed baseline.
        let lastLoaded = 0;
        let lastTime = performance.now();
        const updateProgress = (progress: number, loaded: number) => {
          const now = performance.now();
          if (loaded < lastLoaded) {
            lastLoaded = loaded;
            lastTime = now;
          }
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

        const downloadStartTime = performance.now();
        await saveDecryptedDownload({
          source: {
            path: `/api/download/${id}`,
            token: authTokenB64,
            tokenHeader: "X-Auth-Token",
            fetchCiphertext: () => api.downloadFile(id, authTokenB64),
          },
          secret,
          salt,
          fileKey: keys.fileKey,
          filename,
          mimeType,
          size: info.size,
          plaintextSize,
          signal: abortCtrl.signal,
          onProgress: updateProgress,
          onDebug: (update) => setState((s) => ({ ...s, debugInfo: update(s.debugInfo) })),
        });

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
    [state.info, state.metadata],
  );

  const reset = useCallback(() => {
    unlockedSecretRef.current = null;
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
    unlock,
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
