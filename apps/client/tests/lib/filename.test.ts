import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { availablePath, sanitizeFilename } from "../../src/lib/filename.js";

describe("sanitizeFilename", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeFilename("Quarterly report 2026.pdf")).toBe("Quarterly report 2026.pdf");
    expect(sanitizeFilename("Übersicht März.xlsx")).toBe("Übersicht März.xlsx");
  });

  it("never lets a name leave the directory it is saved in", () => {
    for (const name of [
      "../../.bashrc",
      "..\\..\\evil.exe",
      "/etc/passwd",
      "a/b/c.txt",
      "C:\\Windows\\x.dll",
    ]) {
      const safe = sanitizeFilename(name);
      expect(safe).not.toMatch(/[/\\]/);
      expect(path.basename(safe)).toBe(safe);
      expect(path.join("/downloads", safe).startsWith("/downloads/")).toBe(true);
    }
  });

  it("drops leading dots, so a sender cannot plant a hidden file", () => {
    expect(sanitizeFilename(".zshenv")).toBe("zshenv");
    expect(sanitizeFilename("...bashrc")).toBe("bashrc");
    expect(sanitizeFilename("../../.ssh/authorized_keys")).toBe("_.._.ssh_authorized_keys");
  });

  it("removes control characters, escape sequences and bidirectional overrides", () => {
    expect(sanitizeFilename("report\x1b]52;c;Y3VybA==\x07.pdf")).toBe("report]52;c;Y3VybA==.pdf");
    expect(sanitizeFilename("a\r\x1b[2Kb.txt")).toBe("a[2Kb.txt");
    expect(sanitizeFilename("invoice\u202Efdp.exe")).toBe("invoicefdp.exe");
    expect(sanitizeFilename("zero\u200Bwidth.txt")).toBe("zerowidth.txt");
  });

  it("replaces characters Windows forbids and prefixes its reserved device names", () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*h.txt')).toBe("a_b_c_d_e_f_g_h.txt");
    expect(sanitizeFilename("CON")).toBe("_CON");
    expect(sanitizeFilename("nul.txt")).toBe("_nul.txt");
    expect(sanitizeFilename("com1.tar.gz")).toBe("_com1.tar.gz");
    expect(sanitizeFilename("COM\u00B9.txt")).toBe("_COM\u00B9.txt");
    expect(sanitizeFilename("conin$")).toBe("_conin$");
    expect(sanitizeFilename("CONOUT$.log")).toBe("_CONOUT$.log");
    expect(sanitizeFilename("console.log")).toBe("console.log");
  });

  it("collapses padding that pushes the real extension out of sight", () => {
    expect(sanitizeFilename(`invoice.pdf${" ".repeat(80)}.exe`)).toBe("invoice.pdf .exe");
    expect(sanitizeFilename("photo\u2800\u2800\u2800.exe")).toBe("photo .exe");
  });

  it("strips trailing dots and spaces, which Windows drops silently", () => {
    expect(sanitizeFilename("notes.txt. . ")).toBe("notes.txt");
  });

  it("falls back to a name when nothing usable is left", () => {
    for (const name of ["", ".", "..", "...", "   ", "\x1b\x07", "\u202E"]) {
      expect(sanitizeFilename(name)).toBe("download");
    }
  });

  it("limits the name to 255 bytes and keeps the extension", () => {
    const long = sanitizeFilename(`${"a".repeat(400)}.pdf`);
    expect(Buffer.byteLength(long)).toBe(255);
    expect(long.endsWith(".pdf")).toBe(true);

    // Three bytes per character, so the cut happens long before 255 characters.
    const wide = sanitizeFilename(`${"報".repeat(200)}.docx`);
    expect(Buffer.byteLength(wide)).toBeLessThanOrEqual(255);
    expect(wide.endsWith(".docx")).toBe(true);
    expect(wide).not.toContain("\uFFFD");
  });

  it("handles a megabyte of name without stalling", () => {
    const start = Date.now();
    const safe = sanitizeFilename(`${"x".repeat(1_000_000)}.txt`);
    expect(Buffer.byteLength(safe)).toBe(255);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("availablePath", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "skysend-filename-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the name when nothing is there yet", () => {
    expect(availablePath(dir, "report.pdf")).toBe(path.join(dir, "report.pdf"));
  });

  it("never returns a path that already holds a file", () => {
    fs.writeFileSync(path.join(dir, "report.pdf"), "mine");
    fs.writeFileSync(path.join(dir, "report (1).pdf"), "mine too");
    expect(availablePath(dir, "report.pdf")).toBe(path.join(dir, "report (2).pdf"));
  });

  it("numbers names without an extension and dotted archives sensibly", () => {
    fs.writeFileSync(path.join(dir, "README"), "");
    fs.writeFileSync(path.join(dir, "backup.tar.gz"), "");
    expect(availablePath(dir, "README")).toBe(path.join(dir, "README (1)"));
    expect(availablePath(dir, "backup.tar.gz")).toBe(path.join(dir, "backup.tar (1).gz"));
  });

  it.skipIf(process.platform === "win32")("treats a dangling symbolic link as taken", () => {
    fs.symlinkSync(path.join(dir, "missing-target"), path.join(dir, "trap.txt"));
    expect(availablePath(dir, "trap.txt")).toBe(path.join(dir, "trap (1).txt"));
  });
});
