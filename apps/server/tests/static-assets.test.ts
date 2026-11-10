import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createAssetHandler, hasFileExtension } from "../src/lib/static-assets.js";

describe("hasFileExtension", () => {
  it("decides like the regex /\\.[^/]+$/ it replaced", () => {
    const paths = [
      "/", "/file/abc", "/logo.svg", "/robots.txt", "/.well-known/security.txt", "/a.b/c",
      "/a/b.", "/a.b.", "/.", "/..", "/.x", "/note/abc-def", "/download-sw.js", "/dir/",
    ];
    for (const path of paths) expect(hasFileExtension(path)).toBe(/\.[^/]+$/.test(path));
  });

  it("stays fast on a long path of dots", () => {
    const path = "/" + ".".repeat(16_000) + "/";
    const start = performance.now();
    expect(hasFileExtension(path)).toBe(false);
    expect(performance.now() - start).toBeLessThan(5);
  });
});

describe("createAssetHandler", () => {
  let dist: string;

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), "skysend-assets-"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log(1);");
    writeFileSync(join(dist, "assets", "flag-ch.svg"), "<svg/>");
    writeFileSync(join(dist, "index.html"), "<html></html>");
  });

  afterEach(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  async function app() {
    const hono = new Hono();
    hono.use("/assets/*", await createAssetHandler(join(dist, "assets")));
    hono.notFound((c) => c.text("passed on", 404));
    return hono;
  }

  it("answers with the file of the build, its type and its length", async () => {
    const res = await (await app()).request("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toBe("console.log(1);");
  });

  it("keeps a file once it was read, since a hashed name never changes", async () => {
    const hono = await app();
    await hono.request("/assets/flag-ch.svg");
    writeFileSync(join(dist, "assets", "flag-ch.svg"), "<svg>changed</svg>");
    expect(await (await hono.request("/assets/flag-ch.svg")).text()).toBe("<svg/>");
  });

  it("passes on a name that is not part of the build, including one added later", async () => {
    const hono = await app();
    writeFileSync(join(dist, "assets", "late.js"), "x");
    for (const path of ["/assets/missing.js", "/assets/late.js", "/assets/"]) {
      const res = await hono.request(path);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("passed on");
    }
  });

  it("never reads outside the assets directory", async () => {
    const hono = await app();
    for (const path of [
      "/assets/../index.html",
      "/assets/%2e%2e/index.html",
      "/assets/..%2findex.html",
      "/assets/%2e%2e%2findex.html",
    ]) {
      const res = await hono.request(path);
      expect(await res.text()).not.toContain("<html>");
    }
  });

  it("passes everything on when there is no build", async () => {
    const hono = new Hono();
    hono.use("/assets/*", await createAssetHandler(join(dist, "nothing-here")));
    hono.notFound((c) => c.text("passed on", 404));
    expect((await hono.request("/assets/index-abc123.js")).status).toBe(404);
  });
});
