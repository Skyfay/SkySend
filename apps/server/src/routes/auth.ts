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
 * Routes:
 *   GET /auth/login     - Redirect to OIDC provider (PKCE flow)
 *   GET /auth/callback  - Handle provider callback, set session cookie
 *   GET /auth/logout    - Clear session cookie, redirect home
 *   GET /auth/session   - Return current user or 401
 */
export function createAuthRoute(config: Config, adapter: OidcAdapterProfile): Hono {
  const app = new Hono();

  const redirectUri = config.OIDC_REDIRECT_URI ?? `${config.BASE_URL}/auth/callback`;

  // ── Login ────────────────────────────────────────────

  app.get("/login", async (c) => {
    let oidcConfig: Awaited<ReturnType<typeof discovery>>;
    try {
      oidcConfig = await discovery(
        new URL(config.OIDC_ISSUER!),
        config.OIDC_CLIENT_ID!,
        config.OIDC_CLIENT_SECRET!,
      );
    } catch (err) {
      console.error("[oidc] Discovery failed:", err);
      return c.json({ error: "OIDC provider discovery failed" }, 502);
    }

    const pkce = await createPkceState();
    const scopes = config.OIDC_SCOPES.split(" ").filter(Boolean);

    const authUrl = buildAuthorizationUrl(oidcConfig, {
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      state: pkce.state,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: "S256",
    });

    // Store PKCE data in a short-lived signed JWT cookie
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

    let oidcConfig: Awaited<ReturnType<typeof discovery>>;
    try {
      oidcConfig = await discovery(
        new URL(config.OIDC_ISSUER!),
        config.OIDC_CLIENT_ID!,
        config.OIDC_CLIENT_SECRET!,
      );
    } catch (err) {
      console.error("[oidc] Discovery failed during callback:", err);
      return c.json({ error: "OIDC provider discovery failed" }, 502);
    }

    const callbackUrl = new URL(c.req.url);
    // Ensure the callback URL reflects BASE_URL origin (needed behind reverse proxies)
    const expectedBase = new URL(redirectUri);
    callbackUrl.protocol = expectedBase.protocol;
    callbackUrl.host = expectedBase.host;

    let tokens: Awaited<ReturnType<typeof authorizationCodeGrant>>;
    try {
      tokens = await authorizationCodeGrant(oidcConfig, callbackUrl, {
        pkceCodeVerifier: pkce.codeVerifier,
        expectedState: pkce.state,
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

    const sessionJwt = await createSessionJwt(
      user,
      config.OIDC_SESSION_SECRET!,
      config.OIDC_SESSION_DURATION,
    );

    // Set session cookie, clear PKCE cookie
    const sessionOpts = sessionCookieOptions(config.BASE_URL, config.OIDC_SESSION_DURATION);
    c.header("Set-Cookie", `${SESSION_COOKIE}=${sessionJwt}; ${sessionOpts}`, { append: true });
    c.header(
      "Set-Cookie",
      `${PKCE_COOKIE}=; ${clearCookieOptions()}`,
      { append: true },
    );

    return c.redirect("/", 302);
  });

  // ── Logout ───────────────────────────────────────────

  app.get("/logout", async (c) => {
    // Clear session cookie
    c.header("Set-Cookie", `${SESSION_COOKIE}=; ${clearCookieOptions()}`);

    // Attempt OIDC end-session redirect if the provider supports it
    try {
      const oidcConfig = await discovery(
        new URL(config.OIDC_ISSUER!),
        config.OIDC_CLIENT_ID!,
        config.OIDC_CLIENT_SECRET!,
      );
      const endSessionUrl = buildEndSessionUrl(oidcConfig, {
        post_logout_redirect_uri: config.BASE_URL + "/",
      });
      return c.redirect(endSessionUrl.href, 302);
    } catch {
      // Provider doesn't support end_session or discovery failed - redirect home
      return c.redirect("/", 302);
    }
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
