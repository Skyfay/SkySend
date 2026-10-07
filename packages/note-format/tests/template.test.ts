import { describe, expect, it } from "vitest";
import {
  MAX_BLOCKS,
  MAX_LABEL_LENGTH,
  NOTE_PAD_BLOCK,
  NoteFormatError,
  cleanLabel,
  noteToText,
  padNote,
  parseNote,
  parseTemplate,
  serializeNote,
  serializeTemplate,
  type NoteBlock,
} from "../src/index.js";

const filled: NoteBlock[] = [
  { type: "text", format: "markdown", text: "secret notes", label: "Anything else?" },
  {
    type: "password",
    entries: [
      { label: "Username", value: "alice" },
      { label: "Password", value: "tR7#kq2Lm9x!" },
    ],
  },
  { type: "code", title: "config.yml", language: "yaml", code: "token: abc" },
  { type: "sshkey", publicKey: "ssh-ed25519 AAAA", privateKey: "-----BEGIN", passphrase: "pw" },
];

const blanked: NoteBlock[] = [
  { type: "text", format: "markdown", text: "", label: "Anything else?" },
  {
    type: "password",
    entries: [
      { label: "Username", value: "" },
      { label: "Password", value: "" },
    ],
  },
  { type: "code", title: "config.yml", language: "yaml", code: "" },
  { type: "sshkey", publicKey: "", privateKey: "", passphrase: "" },
];

describe("serializeTemplate", () => {
  it("keeps the structure and the labels, and drops every value", () => {
    expect(serializeTemplate(filled)).toEqual({ v: 1, blocks: blanked });
  });

  it("drops the fields an editor keeps for itself", () => {
    const withId = { ...filled[1]!, id: "editor-7" };
    expect(serializeTemplate([withId]).blocks[0]).not.toHaveProperty("id");
  });

  it("drops an empty text label, and adds none", () => {
    const template = serializeTemplate([
      { type: "text", format: "plain", text: "", label: "  " },
      { type: "text", format: "plain", text: "hello" },
    ]);
    expect(template.blocks).toEqual([
      { type: "text", format: "plain", text: "" },
      { type: "text", format: "plain", text: "" },
    ]);
  });

  it("refuses no blocks, too many blocks and a broken block", () => {
    expect(() => serializeTemplate([])).toThrow(NoteFormatError);
    const many = Array.from({ length: MAX_BLOCKS + 1 }, () => filled[0]!);
    expect(() => serializeTemplate(many)).toThrow(`at most ${MAX_BLOCKS} blocks`);
    expect(() => serializeTemplate([{ type: "text" } as NoteBlock])).toThrow("not valid");
  });
});

describe("entries that are no secret", () => {
  const block: NoteBlock = {
    type: "password",
    entries: [
      { label: "Username", value: "alice", secret: false },
      { label: "Password", value: "tR7#kq2Lm9x!" },
      { label: "Pin", value: "4711", secret: true },
    ],
  };

  it("keeps which entries are no secret, and drops their values too", () => {
    const expected = [
      {
        type: "password",
        entries: [
          { label: "Username", value: "", secret: false },
          { label: "Password", value: "" },
          { label: "Pin", value: "" },
        ],
      },
    ];
    expect(serializeTemplate([block]).blocks).toEqual(expected);
    expect(parseTemplate({ v: 1, blocks: [block] })).toEqual(expected);
  });

  it("keeps the title of a password block, cleaned, and drops an empty one", () => {
    const titled = { ...block, label: "  Server\u202E access " };
    expect(parseTemplate({ v: 1, blocks: [titled] })[0]).toMatchObject({ label: "Server access" });
    expect(parseTemplate({ v: 1, blocks: [{ ...block, label: "\u200B" }] })[0]).not.toHaveProperty(
      "label",
    );
  });

  it("keeps the title of an SSH key block and puts it above the key in the text", () => {
    const key: NoteBlock = {
      type: "sshkey",
      publicKey: "ssh-ed25519 AAAA",
      privateKey: "secret",
      passphrase: "",
      label: "Deploy\u202E key",
    };
    expect(parseTemplate({ v: 1, blocks: [key] })).toEqual([
      { type: "sshkey", publicKey: "", privateKey: "", passphrase: "", label: "Deploy key" },
    ]);
    expect(noteToText([{ ...key, label: "Deploy key" }])).toBe(
      "Deploy key\nssh-ed25519 AAAA\n\nsecret",
    );
  });

  it("puts the title of a password block above its entries in the text of a note", () => {
    const text = noteToText([
      { type: "password", label: "Wi-Fi", entries: [{ label: "SSID", value: "home" }] },
    ]);
    expect(text).toBe("Wi-Fi\nSSID: home");
  });

  it("round-trips a note with an entry that is no secret", () => {
    expect(parseNote(serializeNote([block]))).toEqual([block]);
  });
});

describe("parseTemplate", () => {
  it("reads what serializeTemplate wrote", () => {
    expect(parseTemplate(serializeTemplate(filled))).toEqual(blanked);
  });

  it("throws away values a crafted template carries, so it cannot put words into an answer", () => {
    expect(parseTemplate({ v: 1, blocks: filled })).toEqual(blanked);
  });

  it("leaves out blocks it cannot read and keeps the rest", () => {
    const template = { v: 1, blocks: [{ type: "form", fields: [] }, filled[1], "junk", null] };
    expect(parseTemplate(template)).toEqual([blanked[1]]);
  });

  it("refuses what is no template, and one with nothing to fill in", () => {
    for (const data of [null, "text", [], { v: 0, blocks: [] }, { v: 1, blocks: "x" }]) {
      expect(() => parseTemplate(data)).toThrow("not a valid document");
    }
    expect(() => parseTemplate({ v: 1, blocks: [] })).toThrow("no block to fill in");
    expect(() => parseTemplate({ v: 1, blocks: [{ type: "form" }] })).toThrow(
      "no block to fill in",
    );
    const tooMany = { v: 1, blocks: Array.from({ length: MAX_BLOCKS + 1 }, () => filled[0]) };
    expect(() => parseTemplate(tooMany)).toThrow("not a valid document");
  });

  it("keeps only a language name a highlighter knows the form of", () => {
    const code = (language: string) => ({
      v: 1,
      blocks: [{ type: "code", title: "", language, code: "" }],
    });
    expect(parseTemplate(code("c++"))).toEqual([
      { type: "code", title: "", language: "c++", code: "" },
    ]);
    for (const language of ["\u202E\u001b[2J", "a b", ""]) {
      expect(parseTemplate(code(language))[0]).toMatchObject({ language: "auto" });
    }
  });

  it("keeps the joiners that emoji and Persian spelling need", () => {
    expect(cleanLabel("👩\u200D💻 می\u200Cخواهم")).toBe("👩\u200D💻 می\u200Cخواهم");
  });

  it("cleans every label a requester wrote", () => {
    const template = {
      v: 1,
      blocks: [
        {
          type: "password",
          entries: [{ label: "Bank‮gnp.exe\u0007 PIN\n\n\tnow", value: "" }],
        },
        { type: "code", title: "ㅤㅤx", language: "auto", code: "" },
        { type: "text", format: "plain", text: "", label: `Z${"́".repeat(30)}` },
      ],
    };
    const [password, code, text] = parseTemplate(template);
    expect(password).toEqual({
      type: "password",
      entries: [{ label: "Bankgnp.exe PIN now", value: "" }],
    });
    expect(code).toMatchObject({ title: "x" });
    expect(text).toMatchObject({ label: "Ź́́" });
  });
});

describe("cleanLabel", () => {
  it("cuts a long label without splitting a character", () => {
    const label = cleanLabel("😀".repeat(MAX_LABEL_LENGTH + 20));
    expect(Array.from(label)).toHaveLength(MAX_LABEL_LENGTH);
    expect(label.isWellFormed()).toBe(true);
  });

  it("keeps an ordinary label as it is", () => {
    expect(cleanLabel("Steuer-ID (11 Ziffern)")).toBe("Steuer-ID (11 Ziffern)");
  });
});

describe("text labels in notes", () => {
  it("round-trip in a note and show up in its text", () => {
    const blocks: NoteBlock[] = [{ type: "text", format: "plain", text: "1234", label: "PIN" }];
    expect(parseNote(serializeNote(blocks))).toEqual(blocks);
    expect(noteToText(blocks)).toBe("PIN\n1234");
    expect(noteToText([{ type: "text", format: "plain", text: "", label: "PIN" }])).toBe("");
  });
});

describe("padNote", () => {
  const bytes = (text: string) => new TextEncoder().encode(text).length;

  it("pads to whole blocks, at least one", () => {
    expect(bytes(padNote("{}"))).toBe(NOTE_PAD_BLOCK);
    expect(bytes(padNote("x".repeat(NOTE_PAD_BLOCK)))).toBe(NOTE_PAD_BLOCK);
    expect(bytes(padNote("x".repeat(NOTE_PAD_BLOCK + 1)))).toBe(2 * NOTE_PAD_BLOCK);
  });

  it("counts bytes the way UTF-8 does", () => {
    for (const text of ["ä".repeat(600), "😀".repeat(300), "€".repeat(400), "a\ud800b"]) {
      const padded = padNote(text);
      expect(bytes(padded) % NOTE_PAD_BLOCK).toBe(0);
      expect(bytes(padded) - bytes(text)).toBeLessThan(NOTE_PAD_BLOCK);
    }
  });

  it("leaves a note that still parses", () => {
    expect(parseNote(padNote(serializeNote(filled)))).toEqual(filled);
  });
});
