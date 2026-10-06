import { describe, expect, it } from "vitest";
import { NOTE_KIND, NoteFormatError, noteToText, readNote, serializeNote, type ReadBlock } from "../src/index.js";

describe("readNote", () => {
  it("reads a note made of blocks", () => {
    const plaintext = serializeNote([{ type: "text", format: "plain", text: "hi" }]);
    expect(readNote(NOTE_KIND, plaintext)).toEqual([{ type: "text", format: "plain", text: "hi" }]);
  });

  it("reads a legacy note through the legacy reader", () => {
    expect(readNote("markdown", "# Title")).toEqual([{ type: "text", format: "markdown", text: "# Title" }]);
  });

  it("refuses a kind it does not know", () => {
    expect(() => readNote("image", "data")).toThrow(NoteFormatError);
  });

  it("refuses a blocks note whose content is not a document", () => {
    expect(() => readNote(NOTE_KIND, "just text")).toThrow(NoteFormatError);
  });

  it("shows a document as plain text when a server labels it as a legacy text note", () => {
    const plaintext = serializeNote([{ type: "password", entries: [{ label: "", value: "x" }] }]);
    expect(readNote("text", plaintext)).toEqual([{ type: "text", format: "plain", text: plaintext }]);
  });
});

describe("noteToText", () => {
  it("joins the blocks with blank lines in a form that reads well when pasted", () => {
    const blocks: ReadBlock[] = [
      { type: "text", format: "markdown", text: "# Server" },
      {
        type: "password",
        entries: [
          { label: "root", value: "pw1" },
          { label: "", value: "pw2" },
        ],
      },
      { type: "code", title: "deploy.sh", language: "bash", code: "make" },
      { type: "code", title: "", language: "auto", code: "ls" },
      { type: "sshkey", publicKey: "ssh-ed25519 AAAA", privateKey: "PRIVATE", passphrase: "pp" },
      { type: "sshkey", publicKey: "ssh-ed25519 BBBB", privateKey: "", passphrase: "" },
    ];
    expect(noteToText(blocks)).toBe(
      [
        "# Server",
        "root: pw1\npw2",
        "deploy.sh\nmake",
        "ls",
        "ssh-ed25519 AAAA\n\nPRIVATE\n\nPassphrase: pp",
        "ssh-ed25519 BBBB",
      ].join("\n\n"),
    );
  });

  it("leaves out unsupported and empty blocks", () => {
    const blocks: ReadBlock[] = [
      { type: "unsupported" },
      { type: "text", format: "plain", text: "" },
      { type: "password", entries: [] },
      { type: "text", format: "plain", text: "kept" },
    ];
    expect(noteToText(blocks)).toBe("kept");
  });

  it("returns an empty string for a note without readable blocks", () => {
    expect(noteToText([])).toBe("");
  });
});
