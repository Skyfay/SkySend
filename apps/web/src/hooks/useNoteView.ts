import { useState, useCallback } from "react";
import {
  deriveKeys,
  computeAuthToken,
  decryptNoteContent,
  toBase64url,
  fromBase64url,
  applyPasswordProtection,
  deriveKeyFromPassword,
  type Argon2idHashFn,
} from "@skysend/crypto";
import { readNote, type ReadBlock } from "@skysend/note-format";
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
  /** The decrypted note, in the order the sender put its blocks. */
  blocks: ReadBlock[] | null;
  /** True when the note could not be read in its format and is shown as it arrived. */
  unreadable: boolean;
  viewCount: number;
  maxViews: number;
}

export function useNoteView() {
  const [state, setState] = useState<NoteViewState>({
    phase: "idle",
    error: null,
    info: null,
    blocks: null,
    unreadable: false,
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
          /* v8 ignore next */
          if (!argon2id) throw new Error("Argon2id is required to decrypt password-protected notes");
          const { key: passwordKey } = await deriveKeyFromPassword(
            password,
            passwordSalt,
            argon2id,
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

        // The view is already used up at this point, and with a limit of one the note is gone.
        // A note that does not parse is shown as plain text, so its content is never lost.
        let blocks: ReadBlock[];
        let unreadable = false;
        try {
          blocks = readNote(info.contentType, content);
        } catch {
          blocks = [{ type: "text", format: "plain", text: content }];
          unreadable = true;
        }

        // Check if this was the last allowed view (maxViews === 0 means unlimited)
        const isDestroyed = result.maxViews > 0 && result.viewCount >= result.maxViews;

        setState({
          phase: isDestroyed ? "destroyed" : "viewing",
          error: null,
          info,
          blocks,
          unreadable,
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
