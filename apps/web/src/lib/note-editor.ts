import { calculateEncryptedSize } from "@skysend/crypto";
import {
  NOTE_KIND,
  padNote,
  serializeNote,
  type LegacyNoteKind,
  type NoteBlock,
  type NoteBlockType,
} from "@skysend/note-format";

/** What a block is called in the interface and in "My Links". Markdown counts on its own. */
export type NoteKindKey = "text" | "markdown" | "password" | "code" | "sshkey";

/** A block while the note is being written, with an id the editor keys it by. */
export type DraftBlock = NoteBlock & { id: number };

/**
 * What a block editor is for. `compose` writes a note, `template` lays out the fields a
 * sender of a file request fills in, without values, and `fill` fills in those fields, with
 * their labels fixed.
 */
export type EditorMode = "compose" | "template" | "fill";

/** Blocks with the ids an editor keys them by, counting from 1. */
export function toDrafts(blocks: readonly NoteBlock[]): DraftBlock[] {
  return blocks.map((block, index) => ({ ...block, id: index + 1 }));
}

/** A new block of a type, as the composer adds it. */
export function emptyBlock(type: NoteBlockType): NoteBlock {
  switch (type) {
    case "text":
      return { type, format: "plain", text: "" };
    case "password":
      return { type, entries: [{ label: "", value: "" }] };
    case "code":
      return { type, title: "", language: "auto", code: "" };
    case "sshkey":
      return { type, publicKey: "", privateKey: "", passphrase: "" };
  }
}

/**
 * The blocks that go into the note. A block without content is left out, and so is a
 * password entry without a value, the way the forms before v3 did it. Pasted SSH keys lose
 * the blank lines around them.
 */
export function blocksToSend(drafts: readonly NoteBlock[]): NoteBlock[] {
  return drafts.flatMap((block): NoteBlock[] => {
    switch (block.type) {
      case "text":
        return block.text.length > 0
          ? [{ type: "text", format: block.format, text: block.text, ...(block.label ? { label: block.label } : {}) }]
          : [];
      case "password": {
        const entries = block.entries
          .filter((entry) => entry.value.length > 0)
          .map((entry) => ({
            label: entry.label,
            value: entry.value,
            ...(entry.secret === false ? { secret: false } : {}),
          }));
        return entries.length > 0 ? [{ type: "password", entries }] : [];
      }
      case "code":
        return block.code.length > 0
          ? [{ type: "code", title: block.title, language: block.language, code: block.code }]
          : [];
      case "sshkey": {
        const publicKey = block.publicKey.trim();
        const privateKey = block.privateKey.trim();
        return publicKey || privateKey || block.passphrase
          ? [{ type: "sshkey", publicKey, privateKey, passphrase: block.passphrase }]
          : [];
      }
    }
  });
}

/** A note for a file request, measured: the blocks that go out, their size, and whether they fit. */
export interface MeasuredNote {
  toSend: NoteBlock[];
  bytes: number;
  limit: number;
  tooLarge: boolean;
  ready: boolean;
}

/**
 * Measures a note for a file request. `maxSize` is the largest note the instance takes,
 * `maxUploadSize` the largest upload the request takes, which the padded and encrypted note
 * has to fit as well.
 */
export function measureRequestNote(
  drafts: readonly NoteBlock[],
  maxSize: number,
  maxUploadSize: number,
): MeasuredNote {
  const toSend = blocksToSend(drafts);
  const document = toSend.length > 0 ? serializeNote(toSend) : "";
  const encoder = new TextEncoder();
  const bytes = encoder.encode(document).length;
  const sent = document ? calculateEncryptedSize(encoder.encode(padNote(document)).length) : 0;
  const tooLarge = bytes > maxSize || sent > maxUploadSize;
  return {
    toSend,
    bytes,
    limit: Math.min(maxSize, maxUploadSize),
    tooLarge,
    ready: toSend.length > 0 && !tooLarge,
  };
}

/** Which kinds of blocks a note holds, each once, in the order they first appear. */
export function noteKinds(blocks: readonly NoteBlock[]): NoteKindKey[] {
  const kinds = blocks.map((block): NoteKindKey => (block.type === "text" && block.format === "markdown" ? "markdown" : block.type));
  return [...new Set(kinds)];
}

/**
 * The kinds of a note in "My Links". A note made of blocks keeps them in this browser, the
 * server never learns them.
 */
export function storedNoteKinds(note: { contentType: typeof NOTE_KIND | LegacyNoteKind; kinds?: NoteKindKey[] }): NoteKindKey[] {
  if (note.contentType === NOTE_KIND) return note.kinds ?? [];
  // LEGACY(notes-v1): a note from before v3 has exactly one kind, its content type.
  return [note.contentType];
}
