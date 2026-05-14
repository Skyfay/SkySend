import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  buildEndSessionUrl,
} from "openid-client";
import type { Config } from "../lib/config.js";
import type { OidcAdapterProfile } from "../auth/types.js";
import {
  createSessionJwt,
  verifySessionJwt,
  createPkceState,
  createPkceJwt,
  verifyPkceJwt,
  SESSION_COOKIE,
  PKCE_COOKIE,
  sessionCookieOptions,
  pkceCookieOptions,
  clearCookieOptions,
} from "../auth/session.js";

/**
 * Create the OIDC auth route group (/auth/*).
 *
 * Discovery is lazy with caching:
 *   - A background warm-up is attempted immediately when the route is created.
 *   - If the provider is unreachable at startup, the server still starts normally.
 *   - On the first actual login request, discovery is retried if not yet cached.
 *   - Once cached, the result is reused for the lifetime of the process.
 *
 * Routes:
 *   GET /auth/login     - Redirect to OIDC provider (PKCE flow)
 *   GET /auth/callback  - Handle provider callback, set session cookie
 *   GET /auth/logout    - Clear session cookie, redirect home
 *   GET /auth/session   - Return current user or 401
 */
export function createAuthRoute(config: Config, adapter: OidcAdapterProfile): Hono {
  const app = new Hono();

  const redirectUri = config.OIDC_REDIRECT_URI ?? `${config.BASE_URL}/auth/callback`;

  // ── Discovery cache (lazy + single-flight) ────────────

  type OidcConfig = Awaited<ReturnType<typeof discovery>>;
  let cachedOidcConfig: OidcConfig | null = null;
  let pendingDiscovery: Promise<OidcConfig> | null = null;

  function fetchOidcConfig(): Promise<OidcConfig> {
    if (cachedOidcConfig) return Promise.resolve(cachedOidcConfig);
    if (pendingDiscovery) return pendingDiscovery;

    pendingDiscovery = discovery(
      new URL(config.OIDC_ISSUER!),
      config.OIDC_CLIENT_ID!,
      config.OIDC_CLIENT_SECRET!,
    ).then((cfg) => {
      cachedOidcConfig = cfg;
      pendingDiscovery = null;
      console.log(`[oidc] Provider metadata loaded from ${config.OIDC_ISSUER}`);
      return cfg;
    }).catch((err) => {
      pendingDiscovery = null; // allow retry on next request
      throw err;
    });

    return pendingDiscovery;
  }

  // Background warm-up: try at startup but don't block or crash if it fails
  fetchOidcConfig().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[oidc] Startup discovery failed (will retry on first login): ${msg}`);
  });

  // ── Login ────────────────────────────────────────────

  app.get("/login", async (c) => {
    let oidcConfig: OidcConfig;
    try {
      oidcConfig = await fetchOidcConfig();
    } catch (err) {
      console.error("[oidc] Discovery failed:", err);
      return c.json({ error: "OIDC provider is currently unreachable - try again later" }, 503);
    }

    const pkce = await createPkceState();
    const scopes = config.OIDC_SCOPES.split(" ").filter(Boolean);

    const authUrl = buildAuthorizationUrl(oidcConfig, {
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      state: pkce.state,
      nonce: pkce.nonce,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: "S256",
    });

    const pkceToken = await createPkceJwt(pkce, config.OIDC_SESSION_SECRET!);
    const cookieOpts = pkceCookieOptions(config.BASE_URL);
    c.header("Set-Cookie", `${PKCE_COOKIE}=${pkceToken}; ${cookieOpts}`);

    return c.redirect(authUrl.href, 302);
  });

  // ── Callback ─────────────────────────────────────────

  app.get("/callback", async (c) => {
    const pkceToken = getCookie(c, PKCE_COOKIE);
    if (!pkceToken) {
      return c.json({ error: "Missing PKCE cookie - login session expired" }, 400);
    }

    const pkce = await verifyPkceJwt(pkceToken, config.OIDC_SESSION_SECRET!);
    if (!pkce) {
      return c.json({ error: "Invalid or expired PKCE cookie" }, 400);
    }

    let oidcConfig: OidcConfig;
    try {
      oidcConfig = await fetchOidcConfig();
    } catch (err) {
      console.error("[oidc] Discovery failed during callback:", err);
      return c.json({ error: "OIDC provider is currently unreachable - try again later" }, 503);
    }

    const callbackUrl = new URL(c.req.url);
    const expectedBase = new URL(redirectUri);
    callbackUrl.protocol = expectedBase.protocol;
    callbackUrl.host = expectedBase.host;

    let tokens: Awaited<ReturnType<typeof authorizationCodeGrant>>;
    try {
      tokens = await authorizationCodeGrant(oidcConfig, callbackUrl, {
        pkceCodeVerifier: pkce.codeVerifier,
        expectedState: pkce.state,
        expectedNonce: pkce.nonce,
      });
    } catch (err) {
      console.error("[oidc] Token exchange failed:", err);
      return c.json({ error: "Token exchange failed" }, 400);
    }

    const claims = tokens.claims();
    if (!claims) {
      return c.json({ error: "No ID token claims received" }, 400);
    }

    const user = adapter.extractUser(claims as Record<string, unknown>);
    const sessionJwt = await createSessionJwt(user, config.OIDC_SESSION_SECRET!, config.OIDC_SESSION_DURATION);

    const sessionOpts = sessionCookieOptions(config.BASE_URL, config.OIDC_SESSION_DURATION);
    c.header("Set-Cookie", `${SESSION_COOKIE}=${sessionJwt}; ${sessionOpts}`, { append: true });
    c.header("Set-Cookie", `${PKCE_COOKIE}=; ${clearCookieOptions()}`, { append: true });

    return c.redirect("/", 302);
  });

  // ── Logout ───────────────────────────────────────────

  app.get("/logout", (c) => {
    c.header("Set-Cookie", `${SESSION_COOKIE}=; ${clearCookieOptions()}`);

    // Use cached config for end-session redirect if available
    if (cachedOidcConfig) {
      try {
        const endSessionUrl = buildEndSessionUrl(cachedOidcConfig, {
          post_logout_redirect_uri: config.BASE_URL + "/",
        });
        return c.redirect(endSessionUrl.href, 302);
      } catch {
        // Provider doesn't support end_session
      }
    }
    return c.redirect("/", 302);
  });

  // ── Session ──────────────────────────────────────────

  app.get("/session", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) {
      return c.json({ error: "Not authenticated" }, 401);
    }
    const user = await verifySessionJwt(token, config.OIDC_SESSION_SECRET!);
    if (!user) {
      return c.json({ error: "Session expired or invalid" }, 401);
    }
    return c.json(user, 200);
  });

  return app;
}
