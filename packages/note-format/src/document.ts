/**
 * The note document: what a note made of blocks holds before it is encrypted.
 *
 * A note is serialized to this JSON document, and the document as a whole is the plaintext
 * that encryptNoteContent() in @skysend/crypto encrypts with AES-256-GCM. The encryption
 * itself does not know or care about the format, so this module never touches a key.
 *
 *   { "v": 1, "blocks": [ { "type": "text", ... }, { "type": "password", ... } ] }
 *
 * Every decrypted document is untrusted input. Anyone with a link can send a crafted note,
 * so parseNote() validates the whole shape, caps its size and turns every block it cannot
 * read into an "unsupported" placeholder instead of trusting it.
 *
 * Rules for a future version: it may add block types and optional fields, never change or
 * remove existing ones. A reader of this version then still shows everything it knows and
 * marks the rest as unsupported.
 */

import { z } from "zod";

/** The format version this package writes. Readers accept it and any later version. */
export const NOTE_DOCUMENT_VERSION = 1;

/**
 * The content type the server stores for a note made of blocks. Which blocks a note holds
 * is inside the encrypted document, so the server learns less than from a legacy type.
 */
export const NOTE_KIND = "blocks";

/** Upper bounds against a crafted document. The server's size limit applies first. */
export const MAX_BLOCKS = 50;
export const MAX_PASSWORD_ENTRIES = 100;
export const MAX_LANGUAGE_LENGTH = 40;

const textBlockSchema = z.object({
  type: z.literal("text"),
  format: z.enum(["plain", "markdown"]),
  text: z.string(),
  /** What the text is about, shown above it. Added after v1 shipped, so it is optional. */
  label: z.string().optional(),
});

const passwordEntrySchema = z.object({
  label: z.string(),
  value: z.string(),
});

const passwordBlockSchema = z.object({
  type: z.literal("password"),
  entries: z.array(passwordEntrySchema).max(MAX_PASSWORD_ENTRIES),
});

const codeBlockSchema = z.object({
  type: z.literal("code"),
  title: z.string(),
  /** A highlight.js language name, or "auto" to detect it when the note is shown. */
  language: z.string().max(MAX_LANGUAGE_LENGTH),
  code: z.string(),
});

const sshKeyBlockSchema = z.object({
  type: z.literal("sshkey"),
  publicKey: z.string(),
  privateKey: z.string(),
  passphrase: z.string(),
});

export const noteBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  passwordBlockSchema,
  codeBlockSchema,
  sshKeyBlockSchema,
]);

export type TextBlock = z.infer<typeof textBlockSchema>;
export type PasswordEntry = z.infer<typeof passwordEntrySchema>;
export type PasswordBlock = z.infer<typeof passwordBlockSchema>;
export type CodeBlock = z.infer<typeof codeBlockSchema>;
export type SshKeyBlock = z.infer<typeof sshKeyBlockSchema>;
export type NoteBlock = z.infer<typeof noteBlockSchema>;
export type NoteBlockType = NoteBlock["type"];

/** A block this version cannot show: a type from a later version, or a malformed one. */
export interface UnsupportedBlock {
  type: "unsupported";
}

/** A block as a reader gets it back. */
export type ReadBlock = NoteBlock | UnsupportedBlock;

export const documentSchema = z.object({
  v: z.number().int().positive(),
  // Each block is checked on its own below, so one bad block does not hide the others.
  blocks: z.array(z.unknown()).max(MAX_BLOCKS),
});

/** Thrown when a note cannot be written or read in this format. */
export class NoteFormatError extends Error {
  override name = "NoteFormatError";
}

/**
 * Serializes blocks into the document that gets encrypted. Validates on the way out too, so
 * an editor bug cannot produce a note its recipient fails to read. Unknown fields, like the
 * ids an editor keeps for its own bookkeeping, are dropped.
 */
export function serializeNote(blocks: readonly NoteBlock[]): string {
  if (blocks.length === 0) {
    throw new NoteFormatError("A note needs at least one block");
  }
  if (blocks.length > MAX_BLOCKS) {
    throw new NoteFormatError(`A note holds at most ${MAX_BLOCKS} blocks`);
  }
  const checked = z.array(noteBlockSchema).safeParse(blocks);
  if (!checked.success) {
    throw new NoteFormatError("A block of the note is not valid");
  }
  return JSON.stringify({ v: NOTE_DOCUMENT_VERSION, blocks: checked.data });
}

/**
 * Parses a decrypted document. Throws when the text is not a document at all. Inside a
 * document, a block that does not match comes back as an UnsupportedBlock.
 */
export function parseNote(plaintext: string): ReadBlock[] {
  let data: unknown;
  try {
    data = JSON.parse(plaintext);
  } catch {
    throw new NoteFormatError("The note is not a valid document");
  }
  const document = documentSchema.safeParse(data);
  if (!document.success) {
    throw new NoteFormatError("The note is not a valid document");
  }
  return document.data.blocks.map((raw): ReadBlock => {
    const block = noteBlockSchema.safeParse(raw);
    return block.success ? block.data : { type: "unsupported" };
  });
}
