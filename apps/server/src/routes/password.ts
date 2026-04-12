import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { constantTimeEqual, fromBase64url } from "@skysend/crypto";

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
    return c.json({ error: "Invalid auth token format" }, 401);
  }

  const storedToken = fromBase64url(upload.authToken);
  if (!constantTimeEqual(providedToken, storedToken)) {
    return c.json({ error: "Invalid password" }, 401);
  }

  return c.json({ ok: true });
});

export { passwordRoute };
