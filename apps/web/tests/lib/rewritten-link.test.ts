// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeRewrittenPath } from "../../src/lib/rewritten-link.js";

const ORIGIN = "http://localhost:3000";

/** Fresh module instance, so the "was rewritten" flag does not leak between cases. */
async function loadFresh(url: string) {
  window.history.replaceState(null, "", url);
  vi.resetModules();
  return await import("../../src/lib/rewritten-link.js");
}

const ID = "c9c9c3a2-9c3b-4585-a9b8-8b001a8051c7";
const SECRET = "Xy1wbZmb0OePQDYhBptXGNdYyUFWZAQhW_JaiMDlT8g";

// ── normalizeRewrittenPath ────────────────────────────────────────────────────

describe("normalizeRewrittenPath", () => {
  it("moves a percent-encoded fragment back onto a file link", () => {
    expect(normalizeRewrittenPath(`/file/${ID}%23${SECRET}`)).toBe(`/file/${ID}#${SECRET}`);
  });

  it("moves a percent-encoded fragment back onto a note link", () => {
    expect(normalizeRewrittenPath(`/note/${ID}%23${SECRET}`)).toBe(`/note/${ID}#${SECRET}`);
  });

  it("handles the legacy /d/ download route", () => {
    expect(normalizeRewrittenPath(`/d/${ID}%23${SECRET}`)).toBe(`/d/${ID}#${SECRET}`);
  });

  it("handles a double-encoded fragment from a gateway that did not decode its wrapper", () => {
    expect(normalizeRewrittenPath(`/file/${ID}%2523${SECRET}`)).toBe(`/file/${ID}#${SECRET}`);
  });

  it("accepts a trailing slash appended by the gateway", () => {
    expect(normalizeRewrittenPath(`/file/${ID}%23${SECRET}/`)).toBe(`/file/${ID}#${SECRET}`);
  });

  it("preserves a secret containing the full base64url alphabet", () => {
    const secret = "aZ09-_bQ";
    expect(normalizeRewrittenPath(`/file/${ID}%23${secret}`)).toBe(`/file/${ID}#${secret}`);
  });

  it("leaves an intact share link alone", () => {
    expect(normalizeRewrittenPath(`/file/${ID}`)).toBeNull();
  });

  it("leaves unrelated paths alone", () => {
    expect(normalizeRewrittenPath("/")).toBeNull();
    expect(normalizeRewrittenPath("/uploads")).toBeNull();
    expect(normalizeRewrittenPath(`/api/info/${ID}`)).toBeNull();
  });

  it("ignores a literal hash, which the browser would have parsed as a fragment", () => {
    expect(normalizeRewrittenPath(`/file/${ID}#${SECRET}`)).toBeNull();
  });

  it("rejects an ID that is not a UUID", () => {
    expect(normalizeRewrittenPath(`/file/short%23${SECRET}`)).toBeNull();
  });

  it("rejects a secret with a character outside the base64url alphabet", () => {
    expect(normalizeRewrittenPath(`/file/${ID}%23abc.def`)).toBeNull();
    expect(normalizeRewrittenPath(`/file/${ID}%23abc/def`)).toBeNull();
  });

  it("rejects an unknown route prefix", () => {
    expect(normalizeRewrittenPath(`/download/${ID}%23${SECRET}`)).toBeNull();
  });
});

// ── applyRewrittenShareLinkFix ────────────────────────────────────────────────

describe("applyRewrittenShareLinkFix", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("moves the key into the fragment and flags the link as rewritten", async () => {
    const mod = await loadFresh(`${ORIGIN}/file/${ID}%23${SECRET}`);
    mod.applyRewrittenShareLinkFix();

    expect(window.location.pathname).toBe(`/file/${ID}`);
    expect(window.location.hash).toBe(`#${SECRET}`);
    expect(mod.wasShareLinkRewritten()).toBe(true);
  });

  it("keeps a query string the gateway appended", async () => {
    const mod = await loadFresh(`${ORIGIN}/file/${ID}%23${SECRET}?utm_source=mail`);
    mod.applyRewrittenShareLinkFix();

    expect(window.location.pathname).toBe(`/file/${ID}`);
    expect(window.location.search).toBe("?utm_source=mail");
    expect(window.location.hash).toBe(`#${SECRET}`);
  });

  it("leaves an intact share link untouched and does not flag it", async () => {
    const mod = await loadFresh(`${ORIGIN}/file/${ID}#${SECRET}`);
    mod.applyRewrittenShareLinkFix();

    expect(window.location.pathname).toBe(`/file/${ID}`);
    expect(window.location.hash).toBe(`#${SECRET}`);
    expect(mod.wasShareLinkRewritten()).toBe(false);
  });

  it("does not flag an ordinary page", async () => {
    const mod = await loadFresh(`${ORIGIN}/uploads`);
    mod.applyRewrittenShareLinkFix();

    expect(window.location.pathname).toBe("/uploads");
    expect(mod.wasShareLinkRewritten()).toBe(false);
  });
});
