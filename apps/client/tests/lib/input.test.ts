import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { asksForPassword, noteSource, readAll, withoutFinalNewline } from "../../src/lib/input.js";

describe("noteSource", () => {
  it("reads a pipe or a redirected file whenever stdin is no terminal", () => {
    for (const type of ["text", "password", "code", "markdown", "sshkey"]) {
      expect(noteSource(type, false)).toBe("pipe");
    }
  });

  it("prompts at a terminal for a note of one line", () => {
    expect(noteSource("text", true)).toBe("prompt");
    expect(noteSource("password", true)).toBe("prompt");
  });

  it("asks for a pipe at a terminal for a note that spans lines", () => {
    for (const type of ["code", "markdown", "sshkey"]) {
      expect(() => noteSource(type, true)).toThrow(`skysend note --type ${type} < file`);
    }
  });
});

describe("asksForPassword", () => {
  it("asks for -p without a value and for a server that requires a password", () => {
    expect(asksForPassword(true, false)).toBe(true);
    expect(asksForPassword(undefined, true)).toBe(true);
    expect(asksForPassword(true, true)).toBe(true);
  });

  it("does not ask when the password is given or none is wanted", () => {
    expect(asksForPassword("hunter2", true)).toBe(false);
    expect(asksForPassword("hunter2", false)).toBe(false);
    expect(asksForPassword(undefined, false)).toBe(false);
  });
});

describe("readAll", () => {
  it("joins every chunk until the stream ends, multi-byte characters included", async () => {
    const bytes = Buffer.from("line one\nzweite Zeile mit Ümlaut\n", "utf-8");
    // Split inside the two bytes of "Ü", the way a pipe may deliver it.
    const at = bytes.indexOf(0xc3) + 1;
    const stream = Readable.from([bytes.subarray(0, at), bytes.subarray(at)]);
    expect(await readAll(stream)).toBe("line one\nzweite Zeile mit Ümlaut\n");
  });

  it("returns an empty string for an empty stream", async () => {
    expect(await readAll(Readable.from([]))).toBe("");
  });
});

describe("withoutFinalNewline", () => {
  it("drops the one line break echo or an editor adds", () => {
    expect(withoutFinalNewline("admin:s3cret\n")).toBe("admin:s3cret");
    expect(withoutFinalNewline("admin:s3cret\r\n")).toBe("admin:s3cret");
  });

  it("keeps every other line break and a note without one", () => {
    expect(withoutFinalNewline("a\nb\n\n")).toBe("a\nb\n");
    expect(withoutFinalNewline("a\nb")).toBe("a\nb");
  });
});
