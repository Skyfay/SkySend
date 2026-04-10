import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";

const existsRoute = new Hono();

/**
 * GET /api/exists/:id
 * Lightweight check if an upload exists and is still available.
 * No authentication required.
 */
existsRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const db = getDb();
  const upload = await db.query.uploads.findFirst({
    columns: { id: true, expiresAt: true, downloadCount: true, maxDownloads: true },
    where: eq(uploads.id, id),
  });

  if (!upload) {
    return c.json({ exists: false }, 404);
  }

  const expired = new Date() >= upload.expiresAt;
  const limitReached = upload.downloadCount >= upload.maxDownloads;

  if (expired || limitReached) {
    return c.json({ exists: false, reason: expired ? "expired" : "limit_reached" }, 410);
  }

  return c.json({ exists: true });
});

export { existsRoute };
