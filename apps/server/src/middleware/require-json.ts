import { createMiddleware } from "hono/factory";

/**
 * Refuses a body that is not application/json with 415, before the route reads it.
 *
 * c.req.json() parses any body whatever its Content-Type. A page on another site could therefore
 * send a text/plain POST, which browsers send as a simple request without a CORS preflight, and
 * the route ran it under the visitor's IP: a wrong token counted against the password lockout of
 * a share, and a new file request used up the visitor's daily limit. Asking for application/json
 * makes the browser send a preflight first, which the CORS allowlist refuses. The web app and the
 * CLI have always sent application/json.
 */
export const requireJson = createMiddleware(async (c, next) => {
  const type = (c.req.header("Content-Type") ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") {
    return c.json({ error: "Content-Type must be application/json" }, 415);
  }
  await next();
});
