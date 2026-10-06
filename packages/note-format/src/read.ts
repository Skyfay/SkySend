import { NOTE_KIND, NoteFormatError, parseNote, type ReadBlock } from "./document.js";
import { isLegacyKind, legacyToBlocks } from "./legacy.js";

/**
 * Turns a decrypted note into blocks, whichever format it was written in. `kind` is the
 * content type the server reports for the note.
 *
 * The server is not trusted. A server that reports the wrong kind only picks the wrong
 * reader here: every block that comes out is plain data, and rendering it stays safe.
 */
export function readNote(kind: string, plaintext: string): ReadBlock[] {
  if (kind === NOTE_KIND) return parseNote(plaintext);
  // LEGACY(notes-v1): notes from before v3. Drop this branch with legacy.ts.
  if (isLegacyKind(kind)) return legacyToBlocks(kind, plaintext);
  throw new NoteFormatError("The note has a type this version does not know");
}
