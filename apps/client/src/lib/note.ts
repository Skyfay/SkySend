import {
  NOTE_KIND,
  findPrivateKey,
  readNote,
  serializeNote,
  type LegacyNoteKind,
  type NoteBlock,
  type ReadBlock,
  type SshKeyBlock,
} from "@skysend/note-format";

/** The note types the CLI offers. Each makes a note of one block, Markdown a text block. */
export const CLI_NOTE_TYPES = ["text", "markdown", "password", "code", "sshkey"] as const;
export type CliNoteType = (typeof CLI_NOTE_TYPES)[number];

export function isCliNoteType(value: string): value is CliNoteType {
  return (CLI_NOTE_TYPES as readonly string[]).includes(value);
}

const PASSPHRASE_LINE = /^Passphrase: (.+)$/m;

/**
 * Splits pasted or read SSH key material into its parts: a private key block, a
 * "Passphrase:" line, and whatever is left as the public key.
 */
export function sshKeyFromText(text: string): SshKeyBlock {
  const privateKey = findPrivateKey(text) ?? "";
  const passphraseLine = text.match(PASSPHRASE_LINE);
  let publicKey = text;
  if (privateKey) publicKey = publicKey.replace(privateKey, "");
  if (passphraseLine) publicKey = publicKey.replace(passphraseLine[0], "");
  return { type: "sshkey", publicKey: publicKey.trim(), privateKey, passphrase: passphraseLine?.[1] ?? "" };
}

/** The block for text given on the command line or written in the TUI. */
export function textToBlock(type: CliNoteType, text: string): NoteBlock {
  switch (type) {
    case "text":
      return { type: "text", format: "plain", text };
    case "markdown":
      return { type: "text", format: "markdown", text };
    case "password":
      return { type: "password", entries: [{ label: "", value: text }] };
    case "code":
      return { type: "code", title: "", language: "auto", code: text };
    case "sshkey":
      return sshKeyFromText(text);
  }
}

/**
 * LEGACY(notes-v1): a block in the plaintext format a server before v3 stores, for servers
 * that do not report noteBlocks. Remove with the legacy content types.
 */
export function toLegacyNote(block: NoteBlock): { contentType: LegacyNoteKind; plaintext: string } {
  switch (block.type) {
    case "text":
      return { contentType: block.format === "markdown" ? "markdown" : "text", plaintext: block.text };
    case "password":
      return {
        contentType: "password",
        plaintext: JSON.stringify(block.entries.map((entry) => ({ label: entry.label, value: entry.value }))),
      };
    case "code":
      // Without a title or language the code goes as it is, the way CLI clients before v3
      // sent it. Servers before v2.9 only read that form, not the JSON list.
      return {
        contentType: "code",
        plaintext:
          block.title || block.language !== "auto"
            ? JSON.stringify([{ title: block.title, language: block.language, code: block.code }])
            : block.code,
      };
    case "sshkey":
      return {
        contentType: "sshkey",
        plaintext: [block.publicKey, block.privateKey, block.passphrase ? `Passphrase: ${block.passphrase}` : ""]
          .filter((part) => part.length > 0)
          .join("\n\n"),
      };
  }
}

/**
 * The content type and the plaintext to encrypt for a note of one block. A server that
 * reports noteBlocks gets a note made of blocks, an older one the legacy format.
 */
export function prepareNote(
  block: NoteBlock,
  serverTakesBlocks: boolean,
): { contentType: typeof NOTE_KIND | LegacyNoteKind; plaintext: string } {
  if (serverTakesBlocks) return { contentType: NOTE_KIND, plaintext: serializeNote([block]) };
  // LEGACY(notes-v1): a server before v3 only knows one content type per note.
  return toLegacyNote(block);
}

/**
 * Reads a decrypted note. The view is used up by then, and with a limit of one the note is
 * gone, so a note that does not parse is shown as plain text instead of being lost.
 */
export function readReceivedNote(kind: string, plaintext: string): { blocks: ReadBlock[]; unreadable: boolean } {
  try {
    return { blocks: readNote(kind, plaintext), unreadable: false };
  } catch {
    return { blocks: [{ type: "text", format: "plain", text: plaintext }], unreadable: true };
  }
}

/**
 * Note text as the terminal may show it. A crafted note can carry escape sequences that hide
 * text, fake a link or move the cursor, and bidirectional overrides that reorder what is
 * shown. Each of them becomes a visible replacement character. Saving keeps the text as it is.
 */
export function forTerminal(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F\u202A-\u202E\u2066-\u2069]/g, "\uFFFD");
}

/** The file name the TUI suggests when a note is saved. A lone SSH key keeps its own. */
export function noteFileName(blocks: readonly ReadBlock[]): string {
  return blocks.length === 1 && blocks[0]?.type === "sshkey" ? "note-sshkey.key" : "note.txt";
}
