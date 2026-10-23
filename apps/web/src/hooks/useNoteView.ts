import { useState, useCallback } from "react";
import { openNote } from "@skysend/transfer";
import type { ReadBlock } from "@skysend/note-format";
import * as api from "@/lib/api";
import { hashWasmArgon2 } from "@/lib/argon2";

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
    async (id: string, secretB64: string, password?: string) => {
      try {
        const info = state.info ?? (await api.fetchNoteInfo(id));
        if (!info) throw new Error("Note not found");
        if (info.hasPassword && password) {
          setState((s) => ({ ...s, phase: "verifying-password" }));
        }

        // The password is checked before the view, which the server counts and which with a
        // limit of one destroys the note.
        const note = await openNote({
          api,
          id,
          info,
          secret: secretB64,
          password,
          argon2id: hashWasmArgon2,
        });
        if (!note) {
          setState((s) => ({ ...s, phase: "needs-password", error: "wrong-password" }));
          return;
        }

        // Check if this was the last allowed view (maxViews === 0 means unlimited)
        const isDestroyed = note.maxViews > 0 && note.viewCount >= note.maxViews;

        setState({
          phase: isDestroyed ? "destroyed" : "viewing",
          error: null,
          info,
          blocks: note.blocks,
          unreadable: note.unreadable,
          viewCount: note.viewCount,
          maxViews: note.maxViews,
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
