/**
 * A note template: the blocks a requester wants a sender to fill in, without their values.
 *
 * It travels inside the encrypted brief of a file request. The requester writes it and every
 * sender with the upload link reads it, so a template is untrusted input the same way a note
 * is: parseTemplate() validates it, drops what it cannot read, cleans every label and throws
 * away any value, so a template can never put words into a sender's answer.
 *
 *   { "v": 1, "blocks": [ { "type": "password", "entries": [ { "label": "PIN", "value": "" } ] } ] }
 *
 * The shape is the note document's, so a filled-in template is a note and nothing new.
 */

import { z } from "zod";
import {
  MAX_BLOCKS,
  NOTE_DOCUMENT_VERSION,
  NoteFormatError,
  documentSchema,
  noteBlockSchema,
  type NoteBlock,
} from "./document.js";

/** The longest label a template keeps, in code points. */
export const MAX_LABEL_LENGTH = 100;

/** A note document without values, as it sits in the brief of a request. */
export type NoteTemplate = {
  v: number;
  blocks: NoteBlock[];
};

/** A highlight.js language name as a template may name it. Anything else becomes "auto". */
const LANGUAGE = /^[A-Za-z0-9_+#.-]{1,40}$/;

/** Characters that draw as blank space but are no whitespace: the Braille blank, Hangul fillers. */
const BLANK_FILLERS = /[⠀ㅤᅟᅠﾠ]/g;
/** Combining marks stacked past what any script needs. */
const MARK_STACKS = /(\p{M}{3})\p{M}+/gu;

/**
 * A label made safe to show to someone else: one line, no control, format or reordering
 * characters, no blank fillers or towers of combining marks, at most MAX_LABEL_LENGTH. The
 * zero-width joiner and non-joiner stay, emoji sequences and Persian spelling need them.
 */
export function cleanLabel(label: string): string {
  const cleaned = label
    .replace(/(?![\s\u200C\u200D])[\p{Cc}\p{Cf}\p{Cs}]/gu, "")
    .replace(BLANK_FILLERS, " ")
    .replace(MARK_STACKS, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, MAX_LABEL_LENGTH).join("");
}

/** The block with every value emptied and every label cleaned. */
function blank(block: NoteBlock): NoteBlock {
  switch (block.type) {
    case "text": {
      const label = block.label === undefined ? "" : cleanLabel(block.label);
      return { type: "text", format: block.format, text: "", ...(label ? { label } : {}) };
    }
    case "password":
      return {
        type: "password",
        entries: block.entries.map((entry) => ({
          label: cleanLabel(entry.label),
          value: "",
          ...(entry.secret === false ? { secret: false } : {}),
        })),
      };
    case "code": {
      const language = LANGUAGE.test(block.language) ? block.language : "auto";
      return { type: "code", title: cleanLabel(block.title), language, code: "" };
    }
    case "sshkey":
      return { type: "sshkey", publicKey: "", privateKey: "", passphrase: "" };
  }
}

/** Turns the blocks of the template editor into the template the brief carries. */
export function serializeTemplate(blocks: readonly NoteBlock[]): NoteTemplate {
  if (blocks.length === 0) throw new NoteFormatError("A template needs at least one block");
  if (blocks.length > MAX_BLOCKS) {
    throw new NoteFormatError(`A template holds at most ${MAX_BLOCKS} blocks`);
  }
  const checked = z.array(noteBlockSchema).safeParse(blocks);
  if (!checked.success) throw new NoteFormatError("A block of the template is not valid");
  return { v: NOTE_DOCUMENT_VERSION, blocks: checked.data.map(blank) };
}

/**
 * Reads the template of a brief into the blocks a sender fills in. Blocks it cannot read are
 * left out. Throws when nothing in it can be filled in.
 */
export function parseTemplate(data: unknown): NoteBlock[] {
  const document = documentSchema.safeParse(data);
  if (!document.success) throw new NoteFormatError("The template is not a valid document");
  const blocks = document.data.blocks.flatMap((raw) => {
    const block = noteBlockSchema.safeParse(raw);
    return block.success ? [blank(block.data)] : [];
  });
  if (blocks.length === 0) throw new NoteFormatError("The template has no block to fill in");
  return blocks;
}

/** Bytes of the text in UTF-8, as TextEncoder counts them, a lone surrogate included. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** The block a padded note is rounded up to. */
export const NOTE_PAD_BLOCK = 1024;

/**
 * Pads a serialized note with spaces to a multiple of NOTE_PAD_BLOCK bytes, so the length of
 * a note sent into a request tells little about how long a password in it is. JSON allows
 * the trailing spaces, so parseNote reads a padded note like any other.
 */
export function padNote(document: string): string {
  const length = utf8Length(document);
  const padded = Math.max(1, Math.ceil(length / NOTE_PAD_BLOCK)) * NOTE_PAD_BLOCK;
  return document + " ".repeat(padded - length);
}
