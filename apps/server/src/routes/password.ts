import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { constantTimeEqual, fromBase64url } from "@skysend/crypto";
import { getClientIp } from "../middleware/rate-limit.js";
import type { PasswordLockout } from "../lib/password-lockout.js";
import { getConfig } from "../lib/config.js";

export function createPasswordRoute(lockout: PasswordLockout) {
  const passwordRoute = new Hono();

  /**
   * POST /api/password/:id
   * Verifies the auth token derived from the user-provided password.
   * This endpoint is called before download when an upload is password-protected.
   *
   * The client derives keys from: secret XOR passwordDerivedKey,
   * then computes an authToken. This endpoint verifies that token.
   */
  passwordRoute.post("/:id", bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: "Request body too large" }, 413) }), async (c) => {
    const id = c.req.param("id");
    const config = getConfig();
    const ip = getClientIp(c, config.TRUST_PROXY);
    const resourceKey = `file:${id}`;

    const lockState = lockout.check(resourceKey, ip);
    if (lockState.locked) {
      c.header("Retry-After", String(lockState.retryAfter));
      return c.json({ error: "Too many failed attempts. Try again later." }, 429);
    }

    let body: { authToken?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.authToken || typeof body.authToken !== "string") {
      return c.json({ error: "Missing authToken in body" }, 400);
    }

    const db = getDb();
    const upload = await db.query.uploads.findFirst({
      where: eq(uploads.id, id),
    });

    if (!upload) {
      return c.json({ error: "Upload not found" }, 404);
    }

    if (!upload.hasPassword) {
      return c.json({ error: "Upload is not password-protected" }, 400);
    }

    // Check if expired
    if (new Date() >= upload.expiresAt) {
      return c.json({ error: "Upload has expired" }, 410);
    }

    // Constant-time comparison of the provided auth token
    let providedToken: Uint8Array;
    try {
      providedToken = fromBase64url(body.authToken);
    } catch {
      lockout.recordFailure(resourceKey, ip);
      return c.json({ error: "Invalid auth token format" }, 401);
    }

    const storedToken = fromBase64url(upload.authToken);
    if (!constantTimeEqual(providedToken, storedToken)) {
      lockout.recordFailure(resourceKey, ip);
      return c.json({ error: "Invalid password" }, 401);
    }

    lockout.recordSuccess(resourceKey, ip);
    return c.json({ ok: true });
  });

  return passwordRoute;
}

