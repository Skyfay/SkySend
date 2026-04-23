import { useState, useCallback } from "react";
import {
  deriveKeys,
  computeAuthToken,
  decryptNoteContent,
  toBase64url,
  fromBase64url,
  applyPasswordProtection,
  deriveKeyFromPassword,
  ARGON2_PARAMS_LEGACY,
  type NoteContentType,
  type Argon2idHashFn,
} from "@skysend/crypto";
import * as api from "@/lib/api";

export type NoteViewPhase =
  | "idle"
  | "loading-info"
  | "needs-password"
  | "verifying-password"
  | "viewing"
  | "destroyed"
  | "error";

interface NoteViewState {
  phase: NoteViewPhase;
  error: string | null;
  info: api.NoteInfo | null;
  content: string | null;
  contentType: NoteContentType | null;
  viewCount: number;
  maxViews: number;
}

export function useNoteView() {
  const [state, setState] = useState<NoteViewState>({
    phase: "idle",
    error: null,
    info: null,
    content: null,
    contentType: null,
    viewCount: 0,
    maxViews: 0,
  });

  const loadInfo = useCallback(async (id: string) => {
    try {
      setState((s) => ({ ...s, phase: "loading-info", error: null }));
      const info = await api.fetchNoteInfo(id);
      const nextPhase = info.hasPassword ? "needs-password" : "idle";
      setState((s) => ({ ...s, phase: nextPhase, info }));
      return info;
    } catch (err) {
      const message =
        err instanceof api.ApiError ? err.message : "Failed to load note info";
      setState((s) => ({ ...s, phase: "error", error: message }));
      return null;
    }
  }, []);

  const view = useCallback(
    async (
      id: string,
      secretB64: string,
      password?: string,
      argon2id?: Argon2idHashFn,
    ) => {
      try {
        const info = state.info ?? (await api.fetchNoteInfo(id));
        if (!info) throw new Error("Note not found");

        let secret = fromBase64url(secretB64);
        const salt = fromBase64url(info.salt);

        // Handle password protection
        if (info.hasPassword && password) {
          setState((s) => ({ ...s, phase: "verifying-password" }));
          if (!info.passwordSalt) throw new Error("Missing password salt");

          const passwordSalt = fromBase64url(info.passwordSalt);
          const isArgon2 = info.passwordAlgo === "argon2id" || info.passwordAlgo === "argon2id-v2";
          // TODO: Remove "pbkdf2" branch once all pre-v2.4.4 notes have expired (~ late 2026)
          const { key: passwordKey } = await deriveKeyFromPassword(
            password,
            passwordSalt,
            isArgon2 ? argon2id : undefined,
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
          const valid = await api.verifyNotePassword(id, authTokenB64);
          if (!valid) {
            setState((s) => ({
              ...s,
              phase: "needs-password",
              error: "wrong-password",
            }));
            return;
          }
        }

        // View the note (increments view count server-side)
        const result = await api.viewNote(id, authTokenB64);

        // Decode base64 content and nonce
        const ciphertext = Uint8Array.from(atob(result.encryptedContent), (c) =>
          c.charCodeAt(0),
        );
        const nonce = Uint8Array.from(atob(result.nonce), (c) =>
          c.charCodeAt(0),
        );

        // Decrypt
        const content = await decryptNoteContent(ciphertext, nonce, keys.metaKey);

        // Check if this was the last allowed view (maxViews === 0 means unlimited)
        const isDestroyed = result.maxViews > 0 && result.viewCount >= result.maxViews;

        setState({
          phase: isDestroyed ? "destroyed" : "viewing",
          error: null,
          info,
          content,
          contentType: info.contentType as NoteContentType,
          viewCount: result.viewCount,
          maxViews: result.maxViews,
        });
      } catch (err) {
        if (err instanceof api.ApiError && err.status === 429) {
          setState((s) => ({ ...s, phase: "needs-password", error: "rate-limited" }));
          return;
        }
        const message =
          err instanceof api.ApiError ? err.message : "Failed to view note";
        setState((s) => ({
          ...s,
          phase: "error",
          error: message,
        }));
      }
    },
    [state.info],
  );

  return { ...state, loadInfo, view };
}
