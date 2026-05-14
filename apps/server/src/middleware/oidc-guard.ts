import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { Config } from "../lib/config.js";
import type { OidcUser } from "../auth/types.js";
import { verifySessionJwt, SESSION_COOKIE } from "../auth/session.js";

/**
 * Variables injected into the Hono context by the OIDC guard.
 */
export interface OidcGuardVariables {
  oidcUser: OidcUser;
}

/**
 * Factory that creates a Hono middleware which enforces OIDC authentication.
 *
 * If the session cookie is valid, the resolved user is placed in `c.var.oidcUser`
 * and the request continues. Otherwise a 401 JSON response is returned.
 */
export function createOidcGuard(config: Config) {
  return createMiddleware<{ Variables: OidcGuardVariables }>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) {
      return c.json({ error: "Authentication required" }, 401);
    }
    const user = await verifySessionJwt(token, config.OIDC_SESSION_SECRET!);
    if (!user) {
      return c.json({ error: "Session expired or invalid" }, 401);
    }
    c.set("oidcUser", user);
    await next();
  });
}
