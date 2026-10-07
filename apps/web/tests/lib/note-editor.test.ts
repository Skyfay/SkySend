import { describe, expect, it } from "vitest";
import { serializeNote, type NoteBlock } from "@skysend/note-format";
import {
  blocksToSend,
  emptyBlock,
  entryFallback,
  measureRequestNote,
  passwordBlockTitle,
  noteKinds,
  storedNoteKinds,
  toDrafts,
} from "../../src/lib/note-editor";

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

describe("passwordBlockTitle and entryFallback", () => {
  it("calls a block of secrets passwords, and one with an entry in clear fields", () => {
    const secret = { label: "", value: "x" };
    const plain = { label: "", value: "alice", secret: false as const };
    expect(passwordBlockTitle({ type: "password", entries: [secret] })).toBe("tab.password");
    expect(passwordBlockTitle({ type: "password", entries: [plain, secret] })).toBe("tab.fields");
    expect(entryFallback(secret)).toBe("password.passwordNumber");
    expect(entryFallback(plain)).toBe("password.fieldNumber");
  });
});

describe("blocksToSend and titles", () => {
  it("keeps the title of an SSH key block", () => {
    const sent = blocksToSend([
      { type: "sshkey", publicKey: " ssh-ed25519 AAAA ", privateKey: "", passphrase: "", label: "Deploy key" },
    ]);
    expect(sent).toEqual([
      { type: "sshkey", publicKey: "ssh-ed25519 AAAA", privateKey: "", passphrase: "", label: "Deploy key" },
    ]);
  });
});

describe("blocksToSend and entries that are no secret", () => {
  it("keeps which entries are no secret", () => {
    const sent = blocksToSend([
      {
        type: "password",
        label: "Server access",
        entries: [
          { label: "User", value: "alice", secret: false },
          { label: "Password", value: "pw", secret: true },
        ],
      },
    ]);
    expect(sent).toEqual([
      {
        type: "password",
        label: "Server access",
        entries: [
          { label: "User", value: "alice", secret: false },
          { label: "Password", value: "pw" },
        ],
      },
    ]);
  });
});

describe("measureRequestNote", () => {
  const note: NoteBlock[] = [{ type: "text", format: "plain", text: "hello" }];

  it("is not ready while nothing would go out", () => {
    const measured = measureRequestNote([{ type: "text", format: "plain", text: "" }], 4096, 1 << 20);
    expect(measured).toMatchObject({ toSend: [], bytes: 0, tooLarge: false, ready: false });
  });

  it("measures the document and is ready when it fits both limits", () => {
    const measured = measureRequestNote(note, 4096, 1 << 20);
    expect(measured.bytes).toBe(new TextEncoder().encode(serializeNote(note)).length);
    expect(measured).toMatchObject({ limit: 4096, tooLarge: false, ready: true });
  });

  it("is too large when the note is larger than the instance takes", () => {
    const measured = measureRequestNote(note, 10, 1 << 20);
    expect(measured).toMatchObject({ limit: 10, tooLarge: true, ready: false });
  });

  it("is too large when the padded and encrypted note is larger than the request takes", () => {
    // The document is far below 1024 bytes, but padding takes it to 1024 before encryption.
    const measured = measureRequestNote(note, 4096, 1024);
    expect(measured).toMatchObject({ limit: 1024, tooLarge: true, ready: false });
  });
});
