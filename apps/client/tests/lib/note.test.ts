import { describe, expect, it } from "vitest";
import {
  decryptNoteContent,
  deriveKeys,
  encryptNoteContent,
  generateSalt,
  generateSecret,
} from "@skysend/crypto";
import { NOTE_KIND, legacyToBlocks, parseNote, type NoteBlock } from "@skysend/note-format";
import {
  CLI_NOTE_TYPES,
  forTerminal,
  isCliNoteType,
  noteFileName,
  prepareNote,
  readReceivedNote,
  sshKeyFromText,
  textToBlock,
  toLegacyNote,
} from "../../src/lib/note.js";

const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTestsOnly user@host";
const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-for-tests-only\n-----END OPENSSH PRIVATE KEY-----";

const BLOCKS: NoteBlock[] = [
  { type: "text", format: "plain", text: "Server access" },
  { type: "text", format: "markdown", text: "# Steps\n\n- one" },
  { type: "password", entries: [{ label: "root", value: "pw1" }, { label: "", value: "pw2" }] },
  { type: "code", title: "deploy.sh", language: "bash", code: "make deploy" },
  { type: "sshkey", publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY, passphrase: "horse staple" },
  { type: "sshkey", publicKey: PUBLIC_KEY, privateKey: "", passphrase: "" },
];

describe("isCliNoteType", () => {
  it("knows the five types the note command offers", () => {
    expect(CLI_NOTE_TYPES).toEqual(["text", "markdown", "password", "code", "sshkey"]);
    for (const type of CLI_NOTE_TYPES) expect(isCliNoteType(type)).toBe(true);
    expect(isCliNoteType("blocks")).toBe(false);
    expect(isCliNoteType("image")).toBe(false);
  });
});

describe("textToBlock", () => {
  it("turns text from the command line into the block of its type", () => {
    expect(textToBlock("text", "hi")).toEqual({ type: "text", format: "plain", text: "hi" });
    expect(textToBlock("markdown", "# hi")).toEqual({ type: "text", format: "markdown", text: "# hi" });
    expect(textToBlock("password", "s3cret\n\nstill one")).toEqual({
      type: "password",
      entries: [{ label: "", value: "s3cret\n\nstill one" }],
    });
    expect(textToBlock("code", "ls -la")).toEqual({ type: "code", title: "", language: "auto", code: "ls -la" });
  });

  it("reads SSH key material for the sshkey type", () => {
    expect(textToBlock("sshkey", PUBLIC_KEY)).toEqual({ type: "sshkey", publicKey: PUBLIC_KEY, privateKey: "", passphrase: "" });
  });
});

describe("sshKeyFromText", () => {
  it("splits a pair with passphrase in any order", () => {
    const expected = { type: "sshkey", publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY, passphrase: "pp with space" };
    expect(sshKeyFromText(`${PUBLIC_KEY}\n\n${PRIVATE_KEY}\n\nPassphrase: pp with space`)).toEqual(expected);
    expect(sshKeyFromText(`Passphrase: pp with space\n${PRIVATE_KEY}\n${PUBLIC_KEY}\n`)).toEqual(expected);
  });

  it("reads a private key on its own", () => {
    expect(sshKeyFromText(`\n${PRIVATE_KEY}\n`)).toEqual({ type: "sshkey", publicKey: "", privateKey: PRIVATE_KEY, passphrase: "" });
  });
});

// LEGACY(notes-v1): drop with toLegacyNote.
describe("toLegacyNote", () => {
  it.each(BLOCKS.map((block) => [block.type, block] as const))(
    "writes a %s block so the reader for notes before v3 gets it back unchanged",
    (_type, block) => {
      const legacy = toLegacyNote(block);
      expect(legacyToBlocks(legacy.contentType, legacy.plaintext)).toEqual([block]);
    },
  );

  it("sends code from the command line as it is, which every server before v3 reads", () => {
    const block = textToBlock("code", "make deploy");
    expect(toLegacyNote(block)).toEqual({ contentType: "code", plaintext: "make deploy" });
    expect(legacyToBlocks("code", "make deploy")).toEqual([block]);
  });

  it("uses the content types a server before v3 knows", () => {
    expect(BLOCKS.map((block) => toLegacyNote(block).contentType)).toEqual([
      "text",
      "markdown",
      "password",
      "code",
      "sshkey",
      "sshkey",
    ]);
  });
});

describe("prepareNote", () => {
  it("makes a note of one block for a server that takes blocks", () => {
    const note = prepareNote(BLOCKS[2]!, true);
    expect(note.contentType).toBe(NOTE_KIND);
    expect(parseNote(note.plaintext)).toEqual([BLOCKS[2]]);
  });

  // LEGACY(notes-v1): drop with toLegacyNote.
  it("falls back to the legacy format for an older server", () => {
    expect(prepareNote(BLOCKS[3]!, false)).toEqual(toLegacyNote(BLOCKS[3]!));
  });

  // LEGACY(notes-v1): the false case goes with toLegacyNote.
  it.each([true, false])("round-trips through the real encryption (server takes blocks: %s)", async (takesBlocks) => {
    for (const block of BLOCKS) {
      const note = prepareNote(block, takesBlocks);
      const keys = await deriveKeys(generateSecret(), generateSalt());
      const encrypted = await encryptNoteContent(note.plaintext, keys.metaKey);
      const plaintext = await decryptNoteContent(encrypted.ciphertext, encrypted.nonce, keys.metaKey);
      expect(readReceivedNote(note.contentType, plaintext)).toEqual({ blocks: [block], unreadable: false });
    }
  });
});

describe("readReceivedNote", () => {
  // LEGACY(notes-v1): drop with the legacy readers.
  it("reads a legacy note", () => {
    expect(readReceivedNote("text", "old")).toEqual({
      blocks: [{ type: "text", format: "plain", text: "old" }],
      unreadable: false,
    });
  });

  it("shows a note made of blocks that does not parse as it arrived", () => {
    expect(readReceivedNote(NOTE_KIND, "garbage")).toEqual({
      blocks: [{ type: "text", format: "plain", text: "garbage" }],
      unreadable: true,
    });
  });
});

describe("noteFileName", () => {
  it("suggests a key file for a lone SSH key and a text file otherwise", () => {
    expect(noteFileName([BLOCKS[5]!])).toBe("note-sshkey.key");
    expect(noteFileName([BLOCKS[0]!])).toBe("note.txt");
    expect(noteFileName([BLOCKS[0]!, BLOCKS[5]!])).toBe("note.txt");
    expect(noteFileName([])).toBe("note.txt");
  });
});

describe("forTerminal", () => {
  it("keeps text, tabs and line breaks", () => {
    expect(forTerminal("line one\n\tline two")).toBe("line one\n\tline two");
    expect(forTerminal("windows\r\nline")).toBe("windows\nline");
  });

  it("makes escape sequences and bidirectional overrides visible instead of running them", () => {
    expect(forTerminal("safe\x1b[8mhidden\x1b[0m")).toBe("safe\uFFFD[8mhidden\uFFFD[0m");
    expect(forTerminal("\x1b]8;;https://evil.example\x07link")).toBe("\uFFFD]8;;https://evil.example\uFFFDlink");
    expect(forTerminal("a\rb\bc\x7fd\x9be")).toBe("a\uFFFDb\uFFFDc\uFFFDd\uFFFDe");
    expect(forTerminal("rm -rf /\u202Etxt.exe")).toBe("rm -rf /\uFFFDtxt.exe");
  });
});
