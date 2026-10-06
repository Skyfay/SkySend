import { describe, expect, it } from "vitest";
import {
  MAX_BLOCKS,
  MAX_LANGUAGE_LENGTH,
  MAX_PASSWORD_ENTRIES,
  NOTE_DOCUMENT_VERSION,
  NoteFormatError,
  parseNote,
  serializeNote,
  type NoteBlock,
} from "../src/index.js";

const text: NoteBlock = { type: "text", format: "plain", text: "Access to the new server." };
const markdown: NoteBlock = { type: "text", format: "markdown", text: "# Steps\n\n- one\n- two" };
const passwords: NoteBlock = {
  type: "password",
  entries: [
    { label: "root", value: "tR7#kq2Lm9x!vB4w" },
    { label: "", value: "second without label" },
  ],
};
const code: NoteBlock = { type: "code", title: "deploy.sh", language: "bash", code: "cd /srv/app\ndocker compose up -d" };
const sshKey: NoteBlock = {
  type: "sshkey",
  publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTestsOnly user@host",
  privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-for-tests-only\n-----END OPENSSH PRIVATE KEY-----",
  passphrase: "",
};
const all = [text, markdown, passwords, code, sshKey];

describe("serializeNote and parseNote", () => {
  it("round-trips every block type in order", () => {
    expect(parseNote(serializeNote(all))).toEqual(all);
  });

  it("keeps unicode, empty strings and characters JSON has to escape", () => {
    const tricky: NoteBlock[] = [
      { type: "text", format: "plain", text: 'Grüße 👋 "quoted" \\ back\nslash </script>' },
      { type: "password", entries: [{ label: "", value: "" }] },
    ];
    expect(parseNote(serializeNote(tricky))).toEqual(tricky);
  });

  it("writes the documented wire format, with the version first", () => {
    expect(serializeNote([text])).toBe(
      '{"v":1,"blocks":[{"type":"text","format":"plain","text":"Access to the new server."}]}',
    );
    expect(NOTE_DOCUMENT_VERSION).toBe(1);
  });

  it("drops fields an editor keeps for itself, like a block id", () => {
    const withId = { ...text, id: 7, expanded: true } as unknown as NoteBlock;
    expect(serializeNote([withId])).not.toContain("id");
    expect(parseNote(serializeNote([withId]))).toEqual([text]);
  });
});

describe("serializeNote", () => {
  it("refuses a note without blocks", () => {
    expect(() => serializeNote([])).toThrow(NoteFormatError);
  });

  it("refuses more than the maximum number of blocks", () => {
    expect(() => serializeNote(Array.from({ length: MAX_BLOCKS }, () => text))).not.toThrow();
    expect(() => serializeNote(Array.from({ length: MAX_BLOCKS + 1 }, () => text))).toThrow(NoteFormatError);
  });

  it("refuses a block that does not match its type", () => {
    const broken = { type: "password", entries: [{ label: "x" }] } as unknown as NoteBlock;
    expect(() => serializeNote([broken])).toThrow(NoteFormatError);
  });

  it("refuses a block type it does not know", () => {
    const unknown = { type: "image", data: "..." } as unknown as NoteBlock;
    expect(() => serializeNote([unknown])).toThrow(NoteFormatError);
  });
});

describe("parseNote", () => {
  it.each([
    ["text that is not JSON", "hello"],
    ["a JSON string", '"hello"'],
    ["null", "null"],
    ["an array", "[]"],
    ["a document without a version", '{"blocks":[]}'],
    ["a version that is not a positive integer", '{"v":0,"blocks":[]}'],
    ["a fractional version", '{"v":1.5,"blocks":[]}'],
    ["blocks that are not a list", '{"v":1,"blocks":{}}'],
  ])("rejects %s", (_name, plaintext) => {
    expect(() => parseNote(plaintext)).toThrow(NoteFormatError);
  });

  it("rejects a document with more than the maximum number of blocks", () => {
    const blocks = Array.from({ length: MAX_BLOCKS + 1 }, () => text);
    expect(() => parseNote(JSON.stringify({ v: 1, blocks }))).toThrow(NoteFormatError);
  });

  it("accepts a document without blocks and returns none", () => {
    expect(parseNote('{"v":1,"blocks":[]}')).toEqual([]);
  });

  it("marks a block type from a later version as unsupported and keeps the rest", () => {
    const plaintext = JSON.stringify({ v: 2, blocks: [text, { type: "image", src: "x" }, code] });
    expect(parseNote(plaintext)).toEqual([text, { type: "unsupported" }, code]);
  });

  it("marks a malformed block as unsupported instead of failing the note", () => {
    const plaintext = JSON.stringify({
      v: 1,
      blocks: [
        { type: "text", format: "html", text: "<b>x</b>" },
        { type: "password", entries: "not a list" },
        { type: "code", title: "x", language: "a".repeat(MAX_LANGUAGE_LENGTH + 1), code: "" },
        { type: "sshkey", publicKey: 42, privateKey: "", passphrase: "" },
        "just a string",
        null,
        sshKey,
      ],
    });
    const blocks = parseNote(plaintext);
    expect(blocks.slice(0, 6)).toEqual(Array.from({ length: 6 }, () => ({ type: "unsupported" })));
    expect(blocks[6]).toEqual(sshKey);
  });

  it("caps the password entries of a block", () => {
    const entries = Array.from({ length: MAX_PASSWORD_ENTRIES + 1 }, () => ({ label: "", value: "x" }));
    expect(parseNote(JSON.stringify({ v: 1, blocks: [{ type: "password", entries }] }))).toEqual([
      { type: "unsupported" },
    ]);
  });

  it("drops fields it does not know, so a later version can add optional ones", () => {
    const plaintext = JSON.stringify({ v: 1, extra: true, blocks: [{ ...code, wrap: true }] });
    expect(parseNote(plaintext)).toEqual([code]);
  });

  it("does not let a crafted __proto__ key reach any prototype", () => {
    const plaintext =
      '{"v":1,"blocks":[{"type":"text","format":"plain","text":"x","__proto__":{"polluted":true}}],"__proto__":{"polluted":true}}';
    const blocks = parseNote(plaintext);
    expect(blocks).toEqual([{ type: "text", format: "plain", text: "x" }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(blocks[0])).toBe(Object.prototype);
  });
});
