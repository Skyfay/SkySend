import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { constantTimeEqual, fromBase64url } from "@skysend/crypto";

/**
 * Middleware that validates the X-Auth-Token header against the stored auth token.
 * Attaches the upload record to the context if valid.
 */
export const authMiddleware = createMiddleware<{
  Variables: { upload: typeof uploads.$inferSelect };
}>(async (c, next) => {
  const id = c.req.param("id");
  if (!id) {
    return c.json({ error: "Missing upload ID" }, 400);
  }

  const tokenHeader = c.req.header("X-Auth-Token");
  if (!tokenHeader) {
    return c.json({ error: "Missing X-Auth-Token header" }, 401);
  }

  const db = getDb();
  const upload = await db.query.uploads.findFirst({
    where: eq(uploads.id, id),
  });

  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  // Constant-time comparison to prevent timing attacks
  let providedToken: Uint8Array;
  try {
    providedToken = fromBase64url(tokenHeader);
  } catch {
    return c.json({ error: "Invalid auth token format" }, 401);
  }

  const storedToken = fromBase64url(upload.authToken);
  if (!constantTimeEqual(providedToken, storedToken)) {
    return c.json({ error: "Invalid auth token" }, 401);
  }

  c.set("upload", upload);
  await next();
});

/**
 * Middleware that validates the X-Owner-Token header for upload management operations.
 * Attaches the upload record to the context if valid.
 */
export const ownerMiddleware = createMiddleware<{
  Variables: { upload: typeof uploads.$inferSelect };
}>(async (c, next) => {
  const id = c.req.param("id");
  if (!id) {
    return c.json({ error: "Missing upload ID" }, 400);
  }

  const tokenHeader = c.req.header("X-Owner-Token");
  if (!tokenHeader) {
    return c.json({ error: "Missing X-Owner-Token header" }, 401);
  }

  const db = getDb();
  const upload = await db.query.uploads.findFirst({
    where: eq(uploads.id, id),
  });

  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  let providedToken: Uint8Array;
  try {
    providedToken = fromBase64url(tokenHeader);
  } catch {
    return c.json({ error: "Invalid owner token format" }, 401);
  }

  const storedToken = fromBase64url(upload.ownerToken);
  if (!constantTimeEqual(providedToken, storedToken)) {
    return c.json({ error: "Invalid owner token" }, 401);
  }

  c.set("upload", upload);
  await next();
});
