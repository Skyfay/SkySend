/**
 * LEGACY(notes-v1): readers for notes written before v3.
 *
 * Before v3 a note had a single content type, stored in plaintext on the server, and a
 * plaintext format of its own. These functions turn such a note into blocks, so the same
 * renderer shows old and new notes. They follow the parsing of the v2 web app exactly,
 * which wrote these notes, and the tests pin that behavior with real v2 notes.
 *
 * Remove this file, its exports in index.ts and its branch in readNote() once no legacy note
 * can exist anymore. The removal checklist in the developer docs lists every other place.
 */

import { z } from "zod";
import type { CodeBlock, NoteBlock, PasswordEntry } from "./document.js";

/**
 * The content types a note had before v3.
 * @deprecated LEGACY(notes-v1). New notes use NOTE_KIND.
 */
export const LEGACY_NOTE_KINDS = ["text", "password", "code", "markdown", "sshkey"] as const;

/** @deprecated LEGACY(notes-v1). New notes use NOTE_KIND. */
export type LegacyNoteKind = (typeof LEGACY_NOTE_KINDS)[number];

/** @deprecated LEGACY(notes-v1). */
export function isLegacyKind(kind: string): kind is LegacyNoteKind {
  return (LEGACY_NOTE_KINDS as readonly string[]).includes(kind);
}

// v2 accepted an entry with any JSON value under "value", as long as the key was there.
// The other keys were optional, which Zod 4 only allows when the schema says so.
const legacyPasswordsSchema = z.array(
  z.object({
    label: z.unknown().optional(),
    value: z.custom<unknown>((value) => value !== undefined),
  }),
);

const legacyCodeSchema = z.array(
  z.object({
    title: z.unknown().optional(),
    language: z.unknown().optional(),
    code: z.string(),
  }),
);

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function readPasswords(content: string): PasswordEntry[] {
  const parsed = legacyPasswordsSchema.safeParse(parseJson(content));
  if (parsed.success) {
    return parsed.data.map((entry) => ({
      label: typeof entry.label === "string" ? entry.label : "",
      value: String(entry.value),
    }));
  }
  // The oldest format: one password per paragraph, without labels.
  return content
    .split("\n\n")
    .filter((value) => value.length > 0)
    .map((value) => ({ label: "", value }));
}

function readCode(content: string): CodeBlock[] {
  const parsed = legacyCodeSchema.safeParse(parseJson(content));
  if (parsed.success) {
    return parsed.data.map((block) => ({
      type: "code",
      title: typeof block.title === "string" ? block.title : "",
      language: typeof block.language === "string" ? block.language : "auto",
      code: block.code,
    }));
  }
  // The oldest format: the whole note is one snippet.
  return [{ type: "code", title: "", language: "auto", code: content }];
}

function readSshKey(content: string): NoteBlock {
  const passphraseMatch = content.match(/^Passphrase: (.+)$/m);
  const passphrase = passphraseMatch?.[1] ?? "";
  const withoutPassphrase = passphraseMatch ? content.replace(passphraseMatch[0], "").trim() : content;
  const privateKeyMatch = withoutPassphrase.match(
    /(-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----)/,
  );
  const privateKey = privateKeyMatch?.[1]?.trim() ?? "";
  const publicKey = (privateKey ? withoutPassphrase.replace(privateKey, "") : withoutPassphrase).trim();
  return { type: "sshkey", publicKey, privateKey, passphrase };
}

/**
 * Turns the decrypted content of a legacy note into blocks.
 * @deprecated LEGACY(notes-v1). New notes are read with parseNote().
 */
export function legacyToBlocks(kind: LegacyNoteKind, content: string): NoteBlock[] {
  switch (kind) {
    case "text":
      return [{ type: "text", format: "plain", text: content }];
    case "markdown":
      return [{ type: "text", format: "markdown", text: content }];
    case "password":
      return [{ type: "password", entries: readPasswords(content) }];
    case "code":
      return readCode(content);
    case "sshkey":
      return [readSshKey(content)];
  }
}
