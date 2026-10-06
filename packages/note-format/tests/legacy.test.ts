import { describe, expect, it } from "vitest";
import {
  LEGACY_NOTE_KINDS,
  MAX_BLOCKS,
  MAX_PASSWORD_ENTRIES,
  NoteFormatError,
  isLegacyKind,
  legacyToBlocks,
} from "../src/index.js";

// LEGACY(notes-v1): this file goes with src/legacy.ts.
//
// The plaintext of each legacy note below is exactly what the v2 web app or CLI client wrote
// before encrypting it, so these tests pin how notes from before v3 keep opening.

const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTestsOnly user@host";
const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-for-tests-only\nsecond-line\n-----END OPENSSH PRIVATE KEY-----";
const PKCS8_KEY = "-----BEGIN ENCRYPTED PRIVATE KEY-----\nfake-encrypted-key\n-----END ENCRYPTED PRIVATE KEY-----";

describe("isLegacyKind", () => {
  it("knows the five content types from before v3", () => {
    expect(LEGACY_NOTE_KINDS).toEqual(["text", "password", "code", "markdown", "sshkey"]);
    for (const kind of LEGACY_NOTE_KINDS) expect(isLegacyKind(kind)).toBe(true);
  });

  it("does not take the new kind or anything else for a legacy one", () => {
    expect(isLegacyKind("blocks")).toBe(false);
    expect(isLegacyKind("TEXT")).toBe(false);
    expect(isLegacyKind("")).toBe(false);
  });
});

describe("legacyToBlocks for text and Markdown", () => {
  it("keeps a text note as it was, including blank lines", () => {
    expect(legacyToBlocks("text", "line one\n\nline two")).toEqual([
      { type: "text", format: "plain", text: "line one\n\nline two" },
    ]);
  });

  it("turns a Markdown note into a Markdown text block", () => {
    expect(legacyToBlocks("markdown", "# Title\n\n- item")).toEqual([
      { type: "text", format: "markdown", text: "# Title\n\n- item" },
    ]);
  });

  it("does not read a text note that happens to look like JSON", () => {
    expect(legacyToBlocks("text", '{"v":1,"blocks":[]}')).toEqual([
      { type: "text", format: "plain", text: '{"v":1,"blocks":[]}' },
    ]);
  });
});

describe("legacyToBlocks for passwords", () => {
  it("reads the JSON list the v2 web app and CLI wrote", () => {
    const content = JSON.stringify([
      { label: "root", value: "tR7#kq2Lm9x!vB4w" },
      { label: "", value: "pg-9fK2wQ7rN3zL" },
    ]);
    expect(legacyToBlocks("password", content)).toEqual([
      {
        type: "password",
        entries: [
          { label: "root", value: "tR7#kq2Lm9x!vB4w" },
          { label: "", value: "pg-9fK2wQ7rN3zL" },
        ],
      },
    ]);
  });

  it("shows a value that is not a string as text and drops a label that is not one", () => {
    const content = JSON.stringify([{ label: 5, value: 1234 }, { value: true }]);
    expect(legacyToBlocks("password", content)).toEqual([
      { type: "password", entries: [{ label: "", value: "1234" }, { label: "", value: "true" }] },
    ]);
  });

  it("reads the oldest format, one password per paragraph", () => {
    expect(legacyToBlocks("password", "first\n\nsecond\n\n\n\nthird")).toEqual([
      {
        type: "password",
        entries: [
          { label: "", value: "first" },
          { label: "", value: "second" },
          { label: "", value: "third" },
        ],
      },
    ]);
  });

  it("takes a single raw password, as `skysend note --type password` sent it", () => {
    expect(legacyToBlocks("password", "correct horse battery staple")).toEqual([
      { type: "password", entries: [{ label: "", value: "correct horse battery staple" }] },
    ]);
  });

  it.each([
    ["JSON that is not a list", '{"value":"x"}'],
    ["a list entry without a value", '[{"label":"x"}]'],
    ["a list entry that is not an object", '["plain"]'],
  ])("falls back to paragraphs for %s, like v2 did", (_name, content) => {
    expect(legacyToBlocks("password", content)).toEqual([
      { type: "password", entries: [{ label: "", value: content }] },
    ]);
  });

  it("returns no entries for an empty note or an empty list", () => {
    expect(legacyToBlocks("password", "")).toEqual([{ type: "password", entries: [] }]);
    expect(legacyToBlocks("password", "[]")).toEqual([{ type: "password", entries: [] }]);
  });
});

describe("legacyToBlocks for code", () => {
  it("turns each snippet of the v2 JSON list into a code block of its own", () => {
    const content = JSON.stringify([
      { title: "deploy.sh", language: "bash", code: "docker compose up -d" },
      { title: "", language: "auto", code: "SELECT 1;" },
    ]);
    expect(legacyToBlocks("code", content)).toEqual([
      { type: "code", title: "deploy.sh", language: "bash", code: "docker compose up -d" },
      { type: "code", title: "", language: "auto", code: "SELECT 1;" },
    ]);
  });

  it("fills in a missing title and language like v2 did", () => {
    expect(legacyToBlocks("code", '[{"code":"x = 1"}]')).toEqual([
      { type: "code", title: "", language: "auto", code: "x = 1" },
    ]);
  });

  it("reads the oldest format, the whole note as one snippet", () => {
    expect(legacyToBlocks("code", "def main():\n    pass")).toEqual([
      { type: "code", title: "", language: "auto", code: "def main():\n    pass" },
    ]);
  });

  it("keeps a JSON list without code as a single snippet of raw text", () => {
    expect(legacyToBlocks("code", '[{"title":"x"}]')).toEqual([
      { type: "code", title: "", language: "auto", code: '[{"title":"x"}]' },
    ]);
  });

  it("returns no blocks for an empty list, as v2 showed nothing", () => {
    expect(legacyToBlocks("code", "[]")).toEqual([]);
  });
});

describe("legacyToBlocks for SSH keys", () => {
  it("splits a generated pair with passphrase, in the order v2 wrote it", () => {
    const content = [PUBLIC_KEY, PRIVATE_KEY, "Passphrase: hunter2 with spaces"].join("\n\n");
    expect(legacyToBlocks("sshkey", content)).toEqual([
      { type: "sshkey", publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY, passphrase: "hunter2 with spaces" },
    ]);
  });

  it("reads a pasted pair without passphrase", () => {
    expect(legacyToBlocks("sshkey", `${PUBLIC_KEY}\n\n${PRIVATE_KEY}`)).toEqual([
      { type: "sshkey", publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY, passphrase: "" },
    ]);
  });

  it("reads a note with only the public key", () => {
    expect(legacyToBlocks("sshkey", `${PUBLIC_KEY}\n`)).toEqual([
      { type: "sshkey", publicKey: PUBLIC_KEY, privateKey: "", passphrase: "" },
    ]);
  });

  it("reads a note with only an encrypted PKCS#8 key and its passphrase", () => {
    expect(legacyToBlocks("sshkey", `${PKCS8_KEY}\n\nPassphrase: s3cret`)).toEqual([
      { type: "sshkey", publicKey: "", privateKey: PKCS8_KEY, passphrase: "s3cret" },
    ]);
  });

  it("reads the passphrase line wherever it is", () => {
    const content = `Passphrase: first\n\n${PUBLIC_KEY}`;
    expect(legacyToBlocks("sshkey", content)).toEqual([
      { type: "sshkey", publicKey: PUBLIC_KEY, privateKey: "", passphrase: "first" },
    ]);
  });
});

describe("legacyToBlocks against crafted notes", () => {
  it("refuses more password entries than a note made of blocks may hold", () => {
    const entries = (count: number) => JSON.stringify(Array.from({ length: count }, () => ({ value: "x" })));
    expect(legacyToBlocks("password", entries(MAX_PASSWORD_ENTRIES))[0]).toMatchObject({ type: "password" });
    expect(() => legacyToBlocks("password", entries(MAX_PASSWORD_ENTRIES + 1))).toThrow(NoteFormatError);
    expect(() => legacyToBlocks("password", "x\n\n".repeat(MAX_PASSWORD_ENTRIES + 1))).toThrow(NoteFormatError);
  });

  it("refuses more code blocks than a note made of blocks may hold", () => {
    const blocks = (count: number) => JSON.stringify(Array.from({ length: count }, () => ({ code: "" })));
    expect(legacyToBlocks("code", blocks(MAX_BLOCKS))).toHaveLength(MAX_BLOCKS);
    expect(() => legacyToBlocks("code", blocks(MAX_BLOCKS + 1))).toThrow(NoteFormatError);
  });

  it("detects the language of a code block whose language is too long to be one", () => {
    const content = JSON.stringify([{ code: "x", language: "a".repeat(41) }, { code: "y", language: "__proto__" }]);
    expect(legacyToBlocks("code", content)).toEqual([
      { type: "code", title: "", language: "auto", code: "x" },
      { type: "code", title: "", language: "__proto__", code: "y" },
    ]);
  });

  it("reads a crafted SSH key note of a megabyte in well under a second", () => {
    const started = performance.now();
    const [block] = legacyToBlocks("sshkey", "-----BEGIN PRIVATE KEY-----".repeat(40000));
    expect(block).toMatchObject({ type: "sshkey", privateKey: "" });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
