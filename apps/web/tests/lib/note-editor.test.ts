import { describe, expect, it } from "vitest";
import { serializeNote, type NoteBlock } from "@skysend/note-format";
import { blocksToSend, emptyBlock, noteKinds, storedNoteKinds, toDrafts } from "../../src/lib/note-editor";

describe("emptyBlock", () => {
  it("starts each type the way its editor expects it", () => {
    expect(emptyBlock("text")).toEqual({ type: "text", format: "plain", text: "" });
    expect(emptyBlock("password")).toEqual({ type: "password", entries: [{ label: "", value: "" }] });
    expect(emptyBlock("code")).toEqual({ type: "code", title: "", language: "auto", code: "" });
    expect(emptyBlock("sshkey")).toEqual({ type: "sshkey", publicKey: "", privateKey: "", passphrase: "" });
  });

  it("returns blocks the note format accepts once they have content", () => {
    const blocks: NoteBlock[] = [
      { ...emptyBlock("text"), text: "x" } as NoteBlock,
      emptyBlock("password"),
      emptyBlock("code"),
      emptyBlock("sshkey"),
    ];
    expect(() => serializeNote(blocks)).not.toThrow();
  });
});

describe("toDrafts", () => {
  it("keys the blocks of a template from 1", () => {
    expect(toDrafts([emptyBlock("text"), emptyBlock("code")]).map((draft) => draft.id)).toEqual([1, 2]);
  });
});

describe("blocksToSend", () => {
  it("keeps the label of a text block from a template, and adds none", () => {
    expect(blocksToSend([{ type: "text", format: "plain", text: "1", label: "PIN" }])).toEqual([
      { type: "text", format: "plain", text: "1", label: "PIN" },
    ]);
    expect(blocksToSend([{ type: "text", format: "plain", text: "1", label: "" }])).toEqual([
      { type: "text", format: "plain", text: "1" },
    ]);
  });

  it("leaves out blocks without content", () => {
    expect(blocksToSend([emptyBlock("text"), emptyBlock("password"), emptyBlock("code"), emptyBlock("sshkey")])).toEqual([]);
  });

  it("leaves out password entries without a value but keeps their order", () => {
    const block: NoteBlock = {
      type: "password",
      entries: [
        { label: "first", value: "a" },
        { label: "empty", value: "" },
        { label: "", value: "b" },
      ],
    };
    expect(blocksToSend([block])).toEqual([
      { type: "password", entries: [{ label: "first", value: "a" }, { label: "", value: "b" }] },
    ]);
  });

  it("keeps text and code exactly as written, including surrounding whitespace", () => {
    const text: NoteBlock = { type: "text", format: "markdown", text: "  # Title\n" };
    const code: NoteBlock = { type: "code", title: "a.sh", language: "bash", code: "\n  ls\n" };
    expect(blocksToSend([text, code])).toEqual([text, code]);
  });

  it("trims pasted SSH keys and keeps a block that only holds a passphrase", () => {
    expect(
      blocksToSend([
        { type: "sshkey", publicKey: "\nssh-ed25519 AAAA\n", privateKey: "  ", passphrase: "" },
        { type: "sshkey", publicKey: "", privateKey: "", passphrase: " pass " },
      ]),
    ).toEqual([
      { type: "sshkey", publicKey: "ssh-ed25519 AAAA", privateKey: "", passphrase: "" },
      { type: "sshkey", publicKey: "", privateKey: "", passphrase: " pass " },
    ]);
  });

  it("drops the ids and anything else an editor added", () => {
    const draft = { id: 4, type: "text", format: "plain", text: "x", dirty: true } as unknown as NoteBlock;
    expect(blocksToSend([draft])).toEqual([{ type: "text", format: "plain", text: "x" }]);
  });
});

describe("noteKinds", () => {
  it("lists each kind once in the order it first appears, with Markdown on its own", () => {
    const blocks: NoteBlock[] = [
      { type: "code", title: "", language: "auto", code: "x" },
      { type: "text", format: "markdown", text: "# x" },
      { type: "text", format: "plain", text: "x" },
      { type: "code", title: "", language: "auto", code: "y" },
      { type: "password", entries: [{ label: "", value: "p" }] },
      { type: "sshkey", publicKey: "k", privateKey: "", passphrase: "" },
    ];
    expect(noteKinds(blocks)).toEqual(["code", "markdown", "text", "password", "sshkey"]);
  });
});

describe("storedNoteKinds", () => {
  it("returns the kinds a note made of blocks keeps in this browser", () => {
    expect(storedNoteKinds({ contentType: "blocks", kinds: ["text", "code"] })).toEqual(["text", "code"]);
  });

  it("returns no kinds for a note made of blocks that has none stored", () => {
    expect(storedNoteKinds({ contentType: "blocks" })).toEqual([]);
  });

  // LEGACY(notes-v1): drop with the legacy branch of storedNoteKinds.
  it("uses the content type of a note from before v3 as its only kind", () => {
    expect(storedNoteKinds({ contentType: "markdown" })).toEqual(["markdown"]);
    expect(storedNoteKinds({ contentType: "sshkey" })).toEqual(["sshkey"]);
  });
});
