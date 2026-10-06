import { useState, useCallback } from "react";
import {
  generateSecret,
  generateSalt,
  deriveKeys,
  computeAuthToken,
  computeOwnerToken,
  encryptNoteContent,
  toBase64url,
  applyPasswordProtection,
  deriveKeyFromPassword,
  randomBytes,
  PASSWORD_SALT_LENGTH,
} from "@skysend/crypto";
import { NOTE_KIND, serializeNote, type NoteBlock } from "@skysend/note-format";
import { hashWasmArgon2 } from "@/lib/argon2";
import { createNote } from "@/lib/api";
import { noteKinds } from "@/lib/note-editor";
import { saveNote } from "@/lib/upload-store";

/** Convert Uint8Array to standard base64 string (browser-safe, no Buffer needed). */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export type NotePhase =
  | "idle"
  | "encrypting"
  | "uploading"
  | "done"
  | "error";

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

      // Generate secret + salt
      const secret = generateSecret();
      const salt = generateSalt();
      const keys = await deriveKeys(secret, salt);

      // The whole document is the plaintext. Which blocks it holds is encrypted with it, the
      // server only ever sees NOTE_KIND.
      const encrypted = await encryptNoteContent(serializeNote(blocks), keys.metaKey);

      // Password protection
      let effectiveSecret: Uint8Array = secret;
      let hasPassword = false;
      let passwordSalt: Uint8Array | undefined;
      let passwordAlgo: "argon2id" | "argon2id-v2" | "pbkdf2" | undefined;

      if (password.length > 0) {
        hasPassword = true;
        passwordSalt = randomBytes(PASSWORD_SALT_LENGTH);
        const { key: passwordKey, algorithm } = await deriveKeyFromPassword(
          password,
          passwordSalt,
          hashWasmArgon2,
        );
        passwordAlgo = algorithm;
        effectiveSecret = applyPasswordProtection(secret, passwordKey);
      }

      // Compute tokens
      const authToken = await computeAuthToken(keys.authKey);
      const ownerToken = await computeOwnerToken(effectiveSecret, salt);

      // Upload
      setState((s) => ({ ...s, phase: "uploading" }));

      const result = await createNote({
        encryptedContent: uint8ToBase64(encrypted.ciphertext),
        nonce: uint8ToBase64(encrypted.nonce),
        salt: toBase64url(salt),
        ownerToken: toBase64url(ownerToken),
        authToken: toBase64url(authToken),
        contentType: NOTE_KIND,
        maxViews,
        expireSec,
        hasPassword,
        passwordSalt: passwordSalt ? toBase64url(passwordSalt) : undefined,
        passwordAlgo,
      });

      // Build share link
      const shareLink = `${window.location.origin}/note/${result.id}#${toBase64url(effectiveSecret)}`;

      // Save to IndexedDB
      await saveNote({
        id: result.id,
        ownerToken: toBase64url(ownerToken),
        secret: toBase64url(effectiveSecret),
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
