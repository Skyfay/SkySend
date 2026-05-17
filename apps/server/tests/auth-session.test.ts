import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SignJWT } from "jose";
import {
  createSessionJwt,
  verifySessionJwt,
  createPkceJwt,
  verifyPkceJwt,
  createPkceState,
  sessionCookieOptions,
  pkceCookieOptions,
  clearCookieOptions,
} from "../src/auth/session.js";
import type { OidcUser } from "../src/auth/types.js";

const SECRET = "test-secret-that-is-at-least-32-chars-long!";

const TEST_USER: OidcUser = {
  sub: "user-123",
  name: "Ada Lovelace",
  email: "ada@example.com",
};

/** Sign a custom payload with the shared test secret (HS256, 1 h). */
async function signCustomJwt(payload: Record<string, unknown>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

// ── createSessionJwt / verifySessionJwt ───────────────────────────────────────

describe("createSessionJwt + verifySessionJwt", () => {
  it("round-trips a valid user", async () => {
    const token = await createSessionJwt(TEST_USER, SECRET, 3600);
    const result = await verifySessionJwt(token, SECRET);
    expect(result).toEqual(TEST_USER);
  });

  it("returns null for a wrong secret", async () => {
    const token = await createSessionJwt(TEST_USER, SECRET, 3600);
    const result = await verifySessionJwt(token, "different-secret-at-least-32-chars-here!");
    expect(result).toBeNull();
  });

  it("returns null for a tampered payload", async () => {
    const token = await createSessionJwt(TEST_USER, SECRET, 3600);
    // Flip the first character of the signature (not the last - its 2 LSBs are
    // base64url padding and are silently ignored by decoders, so a flip there
    // may leave the decoded bytes unchanged and produce a still-valid signature).
    const parts = token.split(".");
    const sig = parts[2]!;
    parts[2] = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    const tampered = parts.join(".");
    const result = await verifySessionJwt(tampered, SECRET);
    expect(result).toBeNull();
  });

  it("returns null for a completely invalid string", async () => {
    const result = await verifySessionJwt("not.a.jwt", SECRET);
    expect(result).toBeNull();
  });

  it("returns null when the JWT payload has wrong field types (e.g. sub is a number)", async () => {
    const token = await signCustomJwt({ sub: 42, name: "Ada Lovelace", email: "ada@example.com" });
    const result = await verifySessionJwt(token, SECRET);
    expect(result).toBeNull();
  });

  it("returns null when the JWT payload is missing required fields entirely", async () => {
    const token = await signCustomJwt({ role: "admin" });
    const result = await verifySessionJwt(token, SECRET);
    expect(result).toBeNull();
  });

  it("returns null for an expired token", async () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const token = await createSessionJwt(TEST_USER, SECRET, 1);
    // Advance time by 2 seconds so the token expires
    vi.setSystemTime(Date.now() + 2_000);
    const result = await verifySessionJwt(token, SECRET);
    expect(result).toBeNull();
  });
});

describe("verifySessionJwt - expired token with fake timers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns null after token expiry", async () => {
    const token = await createSessionJwt(TEST_USER, SECRET, 1);
    vi.setSystemTime(Date.now() + 2_000);
    const result = await verifySessionJwt(token, SECRET);
    expect(result).toBeNull();
  });
});

// ── createPkceJwt / verifyPkceJwt ────────────────────────────────────────────

describe("createPkceJwt + verifyPkceJwt", () => {
  const PKCE = {
    state: "abc-state",
    nonce: "abc-nonce",
    codeVerifier: "abc-verifier",
    codeChallenge: "abc-challenge",
  };

  it("round-trips PKCE state", async () => {
    const token = await createPkceJwt(PKCE, SECRET);
    const result = await verifyPkceJwt(token, SECRET);
    expect(result).toMatchObject({
      state: "abc-state",
      nonce: "abc-nonce",
      codeVerifier: "abc-verifier",
    });
    expect(result?.cliCallback).toBeUndefined();
  });

  it("round-trips with optional cliCallback", async () => {
    const pkceWithCli = { ...PKCE, cliCallback: "http://127.0.0.1:12345/callback" };
    const token = await createPkceJwt(pkceWithCli, SECRET);
    const result = await verifyPkceJwt(token, SECRET);
    expect(result?.cliCallback).toBe("http://127.0.0.1:12345/callback");
  });

  it("returns null for wrong secret", async () => {
    const token = await createPkceJwt(PKCE, SECRET);
    const result = await verifyPkceJwt(token, "wrong-secret-at-least-32-chars-padding-xx");
    expect(result).toBeNull();
  });

  it("returns null for invalid string", async () => {
    const result = await verifyPkceJwt("garbage", SECRET);
    expect(result).toBeNull();
  });

  it("returns null when the PKCE JWT payload is missing required fields", async () => {
    const token = await signCustomJwt({ someOtherClaim: "value" });
    const result = await verifyPkceJwt(token, SECRET);
    expect(result).toBeNull();
  });

  it("returns null when PKCE JWT payload has wrong field types (e.g. state is a number)", async () => {
    const token = await signCustomJwt({ state: 42, nonce: "n", codeVerifier: "v" });
    const result = await verifyPkceJwt(token, SECRET);
    expect(result).toBeNull();
  });
});

describe("verifyPkceJwt - expired token with fake timers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns null after 5 minutes", async () => {
    const PKCE = {
      state: "s",
      nonce: "n",
      codeVerifier: "v",
      codeChallenge: "c",
    };
    const token = await createPkceJwt(PKCE, SECRET);
    // Advance past the 5-minute PKCE expiry
    vi.setSystemTime(Date.now() + 6 * 60 * 1_000);
    const result = await verifyPkceJwt(token, SECRET);
    expect(result).toBeNull();
  });
});

// ── createPkceState ───────────────────────────────────────────────────────────

describe("createPkceState", () => {
  it("returns all required fields as non-empty strings", async () => {
    const pkce = await createPkceState();
    expect(typeof pkce.state).toBe("string");
    expect(pkce.state.length).toBeGreaterThan(0);
    expect(typeof pkce.nonce).toBe("string");
    expect(pkce.nonce.length).toBeGreaterThan(0);
    expect(typeof pkce.codeVerifier).toBe("string");
    expect(pkce.codeVerifier.length).toBeGreaterThan(0);
    expect(typeof pkce.codeChallenge).toBe("string");
    expect(pkce.codeChallenge.length).toBeGreaterThan(0);
  });

  it("generates unique values on each call", async () => {
    const a = await createPkceState();
    const b = await createPkceState();
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

// ── Cookie option helpers ─────────────────────────────────────────────────────

describe("sessionCookieOptions", () => {
  it("includes HttpOnly, SameSite=Lax, Path=/ and Max-Age", () => {
    const opts = sessionCookieOptions("http://example.com", 3600);
    expect(opts).toContain("HttpOnly");
    expect(opts).toContain("SameSite=Lax");
    expect(opts).toContain("Path=/");
    expect(opts).toContain("Max-Age=3600");
  });

  it("does NOT include Secure for http origins", () => {
    const opts = sessionCookieOptions("http://example.com", 3600);
    expect(opts).not.toContain("Secure");
  });

  it("includes Secure for https origins", () => {
    const opts = sessionCookieOptions("https://example.com", 3600);
    expect(opts).toContain("Secure");
  });
});

describe("pkceCookieOptions", () => {
  it("sets Max-Age to 300 (5 minutes)", () => {
    const opts = pkceCookieOptions("http://example.com");
    expect(opts).toContain("Max-Age=300");
  });

  it("includes HttpOnly and SameSite=Lax", () => {
    const opts = pkceCookieOptions("http://example.com");
    expect(opts).toContain("HttpOnly");
    expect(opts).toContain("SameSite=Lax");
  });
});

describe("clearCookieOptions", () => {
  it("sets Max-Age=0 to clear the cookie", () => {
    const opts = clearCookieOptions();
    expect(opts).toContain("Max-Age=0");
  });

  it("includes Path=/ and HttpOnly", () => {
    const opts = clearCookieOptions();
    expect(opts).toContain("Path=/");
    expect(opts).toContain("HttpOnly");
  });
});
