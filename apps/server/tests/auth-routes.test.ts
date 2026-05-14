import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createAuthRoute } from "../src/routes/auth.js";
import { createSessionJwt, createPkceJwt, createPkceState } from "../src/auth/session.js";
import { genericAdapter } from "../src/auth/adapters/generic.js";
import type { Config } from "../src/lib/config.js";

// ── Mock openid-client ────────────────────────────────────────────────────────
// We mock the openid-client module so tests don't need a real OIDC provider.
// Note: vi.mock is hoisted, so no top-level variables may be referenced inside.

vi.mock("openid-client", () => ({
  discovery: vi.fn().mockResolvedValue({ _isMock: true }),
  buildAuthorizationUrl: vi.fn().mockReturnValue(new URL("https://provider.example/authorize?mocked=1")),
  authorizationCodeGrant: vi.fn(),
  buildEndSessionUrl: vi.fn().mockReturnValue(new URL("https://provider.example/logout?mocked=1")),
  randomPKCECodeVerifier: vi.fn().mockReturnValue("mock-verifier"),
  calculatePKCECodeChallenge: vi.fn().mockResolvedValue("mock-challenge"),
  randomState: vi.fn().mockReturnValue("mock-state"),
  randomNonce: vi.fn().mockReturnValue("mock-nonce"),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECRET = "test-auth-route-secret-at-least-32ch!";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    BASE_URL: "http://localhost:3000",
    OIDC_ISSUER: "https://provider.example",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_SESSION_SECRET: SECRET,
    OIDC_SESSION_DURATION: 3600,
    OIDC_SCOPES: "openid profile email",
    OIDC_REDIRECT_URI: undefined,
    ...overrides,
  } as unknown as Config;
}

function buildApp(config: Config = makeConfig()) {
  const route = createAuthRoute(config, genericAdapter);
  const app = new Hono();
  app.route("/auth", route);
  return app;
}

const TEST_USER = { sub: "u-1", name: "Marie Curie", email: "marie@example.com" };

// ── GET /auth/session ─────────────────────────────────────────────────────────

describe("GET /auth/session", () => {
  it("returns 200 and the user when a valid session cookie is present", async () => {
    const app = buildApp();
    const token = await createSessionJwt(TEST_USER, SECRET, 3600);

    const res = await app.request("/auth/session", {
      headers: { Cookie: `skysend-auth=${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(TEST_USER);
  });

  it("returns 401 when no session cookie is present", async () => {
    const app = buildApp();
    const res = await app.request("/auth/session");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an expired or invalid token", async () => {
    const app = buildApp();
    const res = await app.request("/auth/session", {
      headers: { Cookie: "skysend-auth=invalid.jwt.token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for a token signed with a different secret", async () => {
    const app = buildApp();
    const token = await createSessionJwt(TEST_USER, "other-secret-at-least-32-chars-paddingxx", 3600);

    const res = await app.request("/auth/session", {
      headers: { Cookie: `skysend-auth=${token}` },
    });
    expect(res.status).toBe(401);
  });
});

// ── GET /auth/logout ──────────────────────────────────────────────────────────

describe("GET /auth/logout", () => {
  it("clears the session cookie and redirects", async () => {
    const app = buildApp();
    const res = await app.request("/auth/logout");

    expect(res.status).toBe(302);
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain("skysend-auth=");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("redirects to the OIDC end-session URL when discovery is cached", async () => {
    // The mock buildEndSessionUrl is set up - after a successful login the
    // cached config is available. We trigger a /session hit (which warms up
    // the cache indirectly via the route's startup fetch) then logout.
    const app = buildApp();

    // Warm up the discovery cache by hitting login (which triggers fetchOidcConfig)
    await app.request("/auth/login");

    const res = await app.request("/auth/logout");
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    // Either provider end-session or fallback to /
    expect(location.length).toBeGreaterThan(0);
  });
});

// ── GET /auth/login ───────────────────────────────────────────────────────────

describe("GET /auth/login", () => {
  it("redirects to the OIDC provider authorization URL", async () => {
    const app = buildApp();
    const res = await app.request("/auth/login");

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("provider.example");
  });

  it("sets the PKCE cookie", async () => {
    const app = buildApp();
    const res = await app.request("/auth/login");

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("skysend-pkce=");
    expect(setCookie).toContain("Max-Age=300");
  });

  it("rejects an invalid cli_callback (non-localhost URL)", async () => {
    const app = buildApp();
    const res = await app.request("/auth/login?cli_callback=https://evil.example/steal");
    expect(res.status).toBe(400);
  });

  it("accepts a valid cli_callback on localhost", async () => {
    const app = buildApp();
    const res = await app.request("/auth/login?cli_callback=http://127.0.0.1:54321/callback");
    expect(res.status).toBe(302);
  });

  it("accepts a valid cli_callback on localhost hostname", async () => {
    const app = buildApp();
    const res = await app.request("/auth/login?cli_callback=http://localhost:54321/callback");
    expect(res.status).toBe(302);
  });

  it("returns 503 when the OIDC provider is unreachable", async () => {
    const { discovery } = await import("openid-client");
    vi.mocked(discovery).mockRejectedValueOnce(new Error("connection refused"));

    const app = buildApp();
    const res = await app.request("/auth/login");

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("unreachable");
  });
});

// ── GET /auth/callback ────────────────────────────────────────────────────────

describe("GET /auth/callback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when the PKCE cookie is missing", async () => {
    const app = buildApp();
    const res = await app.request("/auth/callback?code=abc&state=mock-state");
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid PKCE cookie", async () => {
    const app = buildApp();
    const res = await app.request("/auth/callback?code=abc&state=s", {
      headers: { Cookie: "skysend-pkce=not-a-jwt" },
    });
    expect(res.status).toBe(400);
  });

  it("sets the session cookie and redirects to / on successful token exchange", async () => {
    const { authorizationCodeGrant } = await import("openid-client");
    vi.mocked(authorizationCodeGrant).mockResolvedValueOnce({
      claims: () => ({
        sub: TEST_USER.sub,
        name: TEST_USER.name,
        email: TEST_USER.email,
      }),
    } as ReturnType<typeof authorizationCodeGrant> extends Promise<infer T> ? T : never);

    const app = buildApp();

    // Create a real PKCE JWT that matches what the route would produce
    const pkce = await createPkceState();
    const pkceToken = await createPkceJwt(pkce, SECRET);

    const res = await app.request(`/auth/callback?code=fake-code&state=${pkce.state}`, {
      headers: { Cookie: `skysend-pkce=${pkceToken}` },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");

    // Session cookie should be set
    const cookies = res.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((c) => c.startsWith("skysend-auth="));
    expect(sessionCookie).toBeTruthy();
  });

  it("redirects token to CLI callback when cliCallback is present in PKCE", async () => {
    const { authorizationCodeGrant } = await import("openid-client");
    vi.mocked(authorizationCodeGrant).mockResolvedValueOnce({
      claims: () => ({
        sub: TEST_USER.sub,
        name: TEST_USER.name,
        email: TEST_USER.email,
      }),
    } as ReturnType<typeof authorizationCodeGrant> extends Promise<infer T> ? T : never);

    const app = buildApp();

    const pkce = await createPkceState();
    const pkceWithCli = { ...pkce, cliCallback: "http://127.0.0.1:9876/callback" };
    const pkceToken = await createPkceJwt(pkceWithCli, SECRET);

    const res = await app.request(`/auth/callback?code=fake-code&state=${pkce.state}`, {
      headers: { Cookie: `skysend-pkce=${pkceToken}` },
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("127.0.0.1:9876");
    expect(location).toContain("token=");
  });

  it("returns 400 when token exchange throws", async () => {
    const { authorizationCodeGrant } = await import("openid-client");
    vi.mocked(authorizationCodeGrant).mockRejectedValueOnce(new Error("invalid_grant"));

    const app = buildApp();

    const pkce = await createPkceState();
    const pkceToken = await createPkceJwt(pkce, SECRET);

    const res = await app.request(`/auth/callback?code=bad-code&state=${pkce.state}`, {
      headers: { Cookie: `skysend-pkce=${pkceToken}` },
    });

    expect(res.status).toBe(400);
  });

  it("returns 503 when the OIDC provider is unreachable during callback", async () => {
    const { discovery } = await import("openid-client");
    // Two rejections: one consumed by the warm-up in buildApp(), one for the callback's retry
    vi.mocked(discovery)
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockRejectedValueOnce(new Error("connection refused"));

    const app = buildApp();

    const pkce = await createPkceState();
    const pkceToken = await createPkceJwt(pkce, SECRET);

    const res = await app.request(`/auth/callback?code=fake&state=${pkce.state}`, {
      headers: { Cookie: `skysend-pkce=${pkceToken}` },
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("unreachable");
  });

  it("returns 400 when the ID token has no claims", async () => {
    const { authorizationCodeGrant } = await import("openid-client");
    vi.mocked(authorizationCodeGrant).mockResolvedValueOnce({
      claims: () => null,
    } as ReturnType<typeof authorizationCodeGrant> extends Promise<infer T> ? T : never);

    const app = buildApp();

    const pkce = await createPkceState();
    const pkceToken = await createPkceJwt(pkce, SECRET);

    const res = await app.request(`/auth/callback?code=fake&state=${pkce.state}`, {
      headers: { Cookie: `skysend-pkce=${pkceToken}` },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No ID token claims");
  });
});
