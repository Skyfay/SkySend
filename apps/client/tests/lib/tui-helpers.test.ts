import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clipboardTools, copyToClipboard } from "../../src/lib/clipboard.js";
import { fetchPublicInstances, INSTANCES_URL } from "../../src/lib/instances.js";
import { expandPath, pastedPaths } from "../../src/lib/paths.js";
import { listSources } from "../../src/lib/upload-job.js";

// ── listSources ───────────────────────────────────────────────────────────────

describe("listSources", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "skysend-sources-"));
    mkdirSync(join(dir, "trip", "day-1"), { recursive: true });
    writeFileSync(join(dir, "trip", "day-1", "b.jpg"), "bb");
    writeFileSync(join(dir, "trip", "a.jpg"), "a");
    writeFileSync(join(dir, "notes.txt"), "notes");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("names the files of a folder by their path from the folder's parent", () => {
    const { entries, folders } = listSources([join(dir, "trip"), join(dir, "notes.txt")]);
    expect(folders).toBe(true);
    expect(entries.map((e) => [e.name, e.size])).toEqual([
      ["trip/a.jpg", 1],
      ["trip/day-1/b.jpg", 2],
      ["notes.txt", 5],
    ]);
  });

  it("says when only files were given", () => {
    expect(listSources([join(dir, "notes.txt")]).folders).toBe(false);
  });

  it("follows a link to a file and skips a link to a folder, which could loop", () => {
    symlinkSync(join(dir, "notes.txt"), join(dir, "trip", "link.txt"));
    symlinkSync(join(dir, "trip"), join(dir, "trip", "loop"));
    const names = listSources([join(dir, "trip")]).entries.map((e) => e.name);
    expect(names).toContain("trip/link.txt");
    expect(names.some((n) => n.includes("loop"))).toBe(false);
  });

  it("stops soon after a limit and says so", () => {
    for (let i = 0; i < 10; i++) writeFileSync(join(dir, "trip", `x${i}.bin`), "x");
    const { entries, truncated } = listSources([join(dir, "trip")], 3);
    expect(truncated).toBe(true);
    expect(entries).toHaveLength(4);
  });

  it("refuses a path that does not exist", () => {
    expect(() => listSources([join(dir, "missing")])).toThrow("File not found");
  });
});

// ── paths ─────────────────────────────────────────────────────────────────────

describe("expandPath", () => {
  it("reads ~ as the home folder and resolves the rest", () => {
    expect(expandPath("~")).toBe(homedir());
    expect(expandPath("~/a/b")).toBe(join(homedir(), "a", "b"));
    expect(expandPath(" docs ")).toBe(resolve("docs"));
  });
});

describe("pastedPaths", () => {
  it.skipIf(process.platform === "win32")("reads the ways terminals paste dropped files", () => {
    expect(pastedPaths("'/tmp/My File.pdf' '/tmp/b.txt'")).toEqual(["/tmp/My File.pdf", "/tmp/b.txt"]);
    expect(pastedPaths("/tmp/My\\ File.pdf")).toEqual(["/tmp/My File.pdf"]);
    expect(pastedPaths('"/tmp/a b"\n/tmp/c')).toEqual(["/tmp/a b", "/tmp/c"]);
    expect(pastedPaths("file:///tmp/a%20b.txt")).toEqual(["/tmp/a b.txt"]);
    expect(pastedPaths("  \n ")).toEqual([]);
  });
});

// ── clipboard ─────────────────────────────────────────────────────────────────

describe("copyToClipboard", () => {
  it("names a tool for each platform", () => {
    expect(clipboardTools("darwin")[0]![0]).toBe("pbcopy");
    expect(clipboardTools("win32")[0]![0]).toBe("clip");
    expect(clipboardTools("linux").map(([c]) => c)).toEqual(["wl-copy", "xclip", "xsel"]);
  });

  it("sends OSC 52 to the terminal when no tool works", () => {
    let written = "";
    const result = copyToClipboard("héllo", (d) => (written += d), [["skysend-no-such-tool", []]]);
    expect(result).toBe("terminal");
    expect(written).toBe(`\x1b]52;c;${Buffer.from("héllo").toString("base64")}\x07`);
  });

  it.skipIf(process.platform === "win32")("takes the first tool that succeeds and still tells the terminal", () => {
    let written = "";
    expect(copyToClipboard("x", (d) => (written += d), [["false", []], ["cat", []]])).toBe("system");
    expect(written).toBe(`\x1b]52;c;${Buffer.from("x").toString("base64")}\x07`);
  });
});

// ── public instances ──────────────────────────────────────────────────────────

describe("fetchPublicInstances", () => {
  const answer = (body: unknown, ok = true) =>
    (async (url: string | URL | Request) => {
      expect(String(url)).toBe(INSTANCES_URL);
      return { ok, json: async () => body } as Response;
    }) as typeof fetch;

  it("keeps the online HTTPS instances and drops what does not parse", async () => {
    const list = await fetchPublicInstances(
      answer({
        instances: [
          { name: "a.example", url: "https://a.example", online: true, country: "Switzerland", fileMaxSize: 10 },
          { name: "b.example", url: "https://b.example", online: false },
          { name: "c.example", url: "http://c.example", online: true },
          { name: 42, url: "https://d.example", online: true },
          { name: "e.example", url: "https://e.example", online: true, fileMaxSize: "big" },
        ],
      }),
    );
    expect(list.map((i) => i.name)).toEqual(["a.example", "e.example"]);
    expect(list[1]!.fileMaxSize).toBeUndefined();
  });

  it("answers an empty list when the registry fails", async () => {
    expect(await fetchPublicInstances(answer({}, false))).toEqual([]);
    expect(await fetchPublicInstances(answer({ nope: true }))).toEqual([]);
    const broken = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await fetchPublicInstances(broken)).toEqual([]);
  });
});
