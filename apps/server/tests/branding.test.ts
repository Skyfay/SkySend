import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BRANDING_PREFIX, createBrandingStatic } from "../src/middleware/branding.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

let root: string;
let outside: string;
let app: Hono;

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "skysend-branding-"));
  root = join(base, "branding");
  outside = join(base, "secret");

  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(root, "nested"), { recursive: true });
  // A directory whose name looks like an image passes the guard but has no body.
  mkdirSync(join(root, "folder.png"), { recursive: true });

  writeFileSync(join(root, "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  writeFileSync(join(root, "icon.PNG"), "png-bytes");
  writeFileSync(join(root, "index.html"), "<h1>should never be served</h1>");
  writeFileSync(join(root, "notes.txt"), "plain text");
  writeFileSync(join(root, "nested", "deep.png"), "png-bytes");
  writeFileSync(join(outside, "skysend.db"), "sqlite");
  writeFileSync(join(outside, "escape.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");

  symlinkSync(join(outside, "escape.svg"), join(root, "linked.svg"));

  app = new Hono();
  app.use(`${BRANDING_PREFIX}*`, ...createBrandingStatic(root));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("branding static assets", () => {
  it("serves an image from the branding directory", async () => {
    const res = await app.request("/branding/logo.svg");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<svg");
  });

  it("serves an image from a subdirectory", async () => {
    const res = await app.request("/branding/nested/deep.png");
    expect(res.status).toBe(200);
  });

  it("matches the extension allowlist case-insensitively", async () => {
    const res = await app.request("/branding/icon.PNG");
    expect(res.status).toBe(200);
  });

  it("sets a cache header on a hit", async () => {
    const res = await app.request("/branding/logo.svg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("does not cache a request the static handler could not serve", async () => {
    const res = await app.request("/branding/folder.png");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("does not serve HTML from the operator-writable directory", async () => {
    const res = await app.request("/branding/index.html");
    expect(res.status).toBe(404);
  });

  it("does not serve other non-image files", async () => {
    const res = await app.request("/branding/notes.txt");
    expect(res.status).toBe(404);
  });

  it("rejects a path traversal attempt", async () => {
    const res = await app.request("/branding/../secret/skysend.db");
    expect(res.status).toBe(404);
  });

  it("rejects an encoded path traversal attempt", async () => {
    const res = await app.request("/branding/%2e%2e/secret/escape.svg");
    expect(res.status).toBe(404);
  });

  it("rejects a traversal whose segment survives URL normalization", async () => {
    // The URL parser resolves ".." and "%2e%2e" segments before routing, so those
    // requests never reach the guard. An encoded slash keeps the segment intact
    // and is what actually exercises the containment check.
    const res = await app.request(
      new Request("http://localhost/branding/..%2fsecret%2fescape.svg"),
    );
    expect(res.status).toBe(404);
  });

  it("rejects malformed percent-encoding", async () => {
    const res = await app.request(new Request("http://localhost/branding/%E0%A4%A.png"));
    expect(res.status).toBe(404);
  });

  it("rejects a symlink pointing outside the branding directory", async () => {
    const res = await app.request("/branding/linked.svg");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a missing file", async () => {
    const res = await app.request("/branding/does-not-exist.png");
    expect(res.status).toBe(404);
  });

  it("returns 404 for the bare prefix", async () => {
    const res = await app.request("/branding/");
    expect(res.status).toBe(404);
  });

  it("serves nothing outside the prefix, whatever it is mounted on", async () => {
    const broad = new Hono();
    broad.use("*", ...createBrandingStatic(root));

    const res = await broad.request("/logo.svg");
    expect(res.status).toBe(404);
  });

  it("still answers when the branding directory cannot be created", async () => {
    const base = mkdtempSync(join(tmpdir(), "skysend-branding-blocked-"));
    writeFileSync(join(base, "blocker"), "not a directory");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const blockedApp = new Hono();
    blockedApp.use(
      `${BRANDING_PREFIX}*`,
      ...createBrandingStatic(join(base, "blocker", "branding")),
    );

    const res = await blockedApp.request("/branding/logo.svg");
    expect(res.status).toBe(404);

    warn.mockRestore();
    rmSync(base, { recursive: true, force: true });
  });

  it("creates the branding directory when it does not exist yet", async () => {
    const base = mkdtempSync(join(tmpdir(), "skysend-branding-new-"));
    const fresh = join(base, "does", "not", "exist");

    const freshApp = new Hono();
    freshApp.use(`${BRANDING_PREFIX}*`, ...createBrandingStatic(fresh));

    writeFileSync(join(fresh, "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    const res = await freshApp.request("/branding/logo.svg");
    expect(res.status).toBe(200);

    rmSync(base, { recursive: true, force: true });
  });
});
