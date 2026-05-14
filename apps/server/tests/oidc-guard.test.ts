import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createOidcGuard } from "../src/middleware/oidc-guard.js";
import { createSessionJwt } from "../src/auth/session.js";
import type { Config } from "../src/lib/config.js";

// Minimal config stub - only fields used by the guard are needed
const SECRET = "test-guard-secret-at-least-32-chars-ok!";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    OIDC_SESSION_SECRET: SECRET,
    ...overrides,
  } as unknown as Config;
}

/** Build a minimal Hono app with the OIDC guard applied and a probe GET /. */
function buildApp(config: Config) {
  const app = new Hono();
  app.use("/*", createOidcGuard(config));
  app.get("/", (c) => {
    const user = c.var.oidcUser;
    return c.json(user);
  });
  return app;
}

const TEST_USER = { sub: "u-1", name: "Nikola Tesla", email: "nikola@example.com" };

// ── Cookie auth ───────────────────────────────────────────────────────────────

describe("createOidcGuard - cookie authentication", () => {
  it("allows a request with a valid session cookie and injects oidcUser", async () => {
    const config = makeConfig();
    const app = buildApp(config);
    const token = await createSessionJwt(TEST_USER, SECRET, 3600);

    const res = await app.request("/", {
      headers: { Cookie: `skysend-auth=${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(TEST_USER);
  });

  it("returns 401 when no auth is provided", async () => {
    const app = buildApp(makeConfig());
    const res = await app.request("/");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid cookie value", async () => {
    const app = buildApp(makeConfig());
    const res = await app.request("/", {
      headers: { Cookie: "skysend-auth=not-a-valid-jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for a cookie signed with a different secret", async () => {
    const app = buildApp(makeConfig());
    const token = await createSessionJwt(TEST_USER, "other-secret-at-least-32-chars-padding-x", 3600);

    const res = await app.request("/", {
      headers: { Cookie: `skysend-auth=${token}` },
    });
    expect(res.status).toBe(401);
  });
});

// ── Bearer token auth ─────────────────────────────────────────────────────────

describe("createOidcGuard - Bearer token authentication", () => {
  it("allows a request with a valid Bearer token and injects oidcUser", async () => {
    const config = makeConfig();
    const app = buildApp(config);
    const token = await createSessionJwt(TEST_USER, SECRET, 3600);

    const res = await app.request("/", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(TEST_USER);
  });

  it("returns 401 for an invalid Bearer token", async () => {
    const app = buildApp(makeConfig());
    const res = await app.request("/", {
      headers: { Authorization: "Bearer garbage.token.here" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for a malformed Authorization header (no Bearer prefix)", async () => {
    const app = buildApp(makeConfig());
    const token = await createSessionJwt(TEST_USER, SECRET, 3600);
    const res = await app.request("/", {
      headers: { Authorization: token },
    });
    expect(res.status).toBe(401);
  });

  it("prefers cookie over Bearer when both are provided", async () => {
    const config = makeConfig();
    const app = buildApp(config);

    const cookieUser = { sub: "cookie-user", name: "Cookie", email: "c@c.com" };
    const bearerUser = { sub: "bearer-user", name: "Bearer", email: "b@b.com" };

    const cookieToken = await createSessionJwt(cookieUser, SECRET, 3600);
    const bearerToken = await createSessionJwt(bearerUser, SECRET, 3600);

    const res = await app.request("/", {
      headers: {
        Cookie: `skysend-auth=${cookieToken}`,
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sub).toBe("cookie-user");
  });
});
