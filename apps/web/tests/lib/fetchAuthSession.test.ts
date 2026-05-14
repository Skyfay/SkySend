import { describe, it, expect, vi, afterEach } from "vitest";

// fetchAuthSession uses the global fetch - we stub it per-test.
// No DOM environment needed since this is a pure async function.

// Dynamic import so vi.stubGlobal takes effect before the module loads its
// own reference to fetch (the function captures the global at call time).
async function getFetchAuthSession() {
  vi.resetModules();
  return (await import("../../src/lib/api.js")).fetchAuthSession;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const VALID_USER = { sub: "u-1", name: "Ada Lovelace", email: "ada@example.com" };

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

// ── fetchAuthSession ──────────────────────────────────────────────────────────

describe("fetchAuthSession", () => {
  it("returns the user when the server responds with 200 and valid JSON", async () => {
    mockFetch(200, VALID_USER);
    const fetchAuthSession = await getFetchAuthSession();
    const result = await fetchAuthSession();
    expect(result).toEqual(VALID_USER);
  });

  it("returns null on 401 (not authenticated)", async () => {
    mockFetch(401, { error: "Not authenticated" });
    const fetchAuthSession = await getFetchAuthSession();
    expect(await fetchAuthSession()).toBeNull();
  });

  it("returns null on 403 (forbidden / OIDC disabled)", async () => {
    mockFetch(403, { error: "Forbidden" });
    const fetchAuthSession = await getFetchAuthSession();
    expect(await fetchAuthSession()).toBeNull();
  });

  it("returns null on any other non-ok status", async () => {
    mockFetch(500, { error: "Server error" });
    const fetchAuthSession = await getFetchAuthSession();
    expect(await fetchAuthSession()).toBeNull();
  });

  it("returns null when the response body is missing required fields", async () => {
    mockFetch(200, { sub: "u-1" }); // name and email missing
    const fetchAuthSession = await getFetchAuthSession();
    expect(await fetchAuthSession()).toBeNull();
  });

  it("returns null when the response body has wrong field types", async () => {
    mockFetch(200, { sub: 42, name: true, email: null });
    const fetchAuthSession = await getFetchAuthSession();
    expect(await fetchAuthSession()).toBeNull();
  });

  it("returns null when fetch throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const fetchAuthSession = await getFetchAuthSession();
    expect(await fetchAuthSession()).toBeNull();
  });
});
