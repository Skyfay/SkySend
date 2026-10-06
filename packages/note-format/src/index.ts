// The public API of @skysend/note-format. Nothing outside this package imports a submodule.

export {
  NOTE_DOCUMENT_VERSION,
  NOTE_KIND,
  MAX_BLOCKS,
  MAX_PASSWORD_ENTRIES,
  MAX_LANGUAGE_LENGTH,
  NoteFormatError,
  serializeNote,
  parseNote,
} from "./document.js";
export type {
  TextBlock,
  PasswordEntry,
  PasswordBlock,
  CodeBlock,
  SshKeyBlock,
  NoteBlock,
  NoteBlockType,
  UnsupportedBlock,
  ReadBlock,
} from "./document.js";

export { readNote } from "./read.js";
export { noteToText } from "./text.js";
export { findPrivateKey } from "./private-key.js";

// LEGACY(notes-v1): readers for notes written before v3.
export { LEGACY_NOTE_KINDS, isLegacyKind, legacyToBlocks } from "./legacy.js";
export type { LegacyNoteKind } from "./legacy.js";
