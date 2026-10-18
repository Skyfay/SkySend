import { useState, useCallback } from "react";
import { buildShareLink, createEncryptedNote } from "@skysend/transfer";
import { NOTE_KIND, padNote, serializeNote, type NoteBlock } from "@skysend/note-format";
import { hashWasmArgon2 } from "@/lib/argon2";
import { createNote } from "@/lib/api";
import { noteKinds } from "@/lib/note-editor";
import { saveNote } from "@/lib/upload-store";

/** "encrypting" covers the request to the server too, both take a moment. */
export type NotePhase = "idle" | "encrypting" | "done" | "error";

interface NoteState {
  phase: NotePhase;
  shareLink: string | null;
  error: string | null;
}

interface NoteUploadOptions {
  /** The blocks to share, already without empty ones. */
  blocks: NoteBlock[];
  maxViews: number;
  expireSec: number;
  password: string;
}

export function useNoteUpload() {
  const [state, setState] = useState<NoteState>({
    phase: "idle",
    shareLink: null,
    error: null,
  });

  const reset = useCallback(() => {
    setState({ phase: "idle", shareLink: null, error: null });
  }, []);

  const upload = useCallback(async (options: NoteUploadOptions) => {
    const { blocks, maxViews, expireSec, password } = options;

    try {
      setState({ phase: "encrypting", shareLink: null, error: null });

      // The whole document is the plaintext. Which blocks it holds is encrypted with it, the
      // server only ever sees NOTE_KIND. Padded to whole blocks, so the length of the note
      // does not give away how long a password in it is.
      const note = await createEncryptedNote({
        api: { createNote },
        plaintext: padNote(serializeNote(blocks)),
        contentType: NOTE_KIND,
        maxViews,
        expireSec,
        password,
        argon2id: hashWasmArgon2,
      });

      const shareLink = buildShareLink(window.location.origin, "note", note.id, note.effectiveSecret);

      // Save to IndexedDB
      await saveNote({
        id: note.id,
        ownerToken: note.ownerToken,
        secret: note.effectiveSecret,
        contentType: NOTE_KIND,
        kinds: noteKinds(blocks),
        createdAt: new Date().toISOString(),
      });

      setState({ phase: "done", shareLink, error: null });
    } catch (err) {
      setState({
        phase: "error",
        shareLink: null,
        error: err instanceof Error ? err.message : "Note creation failed",
      });
    }
  }, []);

  return { ...state, upload, reset };
}
