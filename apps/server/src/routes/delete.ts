import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { ownerMiddleware } from "../middleware/auth.js";
import type { Upload } from "../db/schema.js";
import type { FileStorage } from "../storage/filesystem.js";

export function createDeleteRoute(storage: FileStorage) {
  const route = new Hono<{
    Variables: { upload: Upload };
  }>();

  /**
   * DELETE /api/upload/:id
   * Deletes an upload and its file from disk. Requires owner token.
   */
  route.delete("/:id", ownerMiddleware, async (c) => {
    const upload = c.get("upload");
    const db = getDb();

    // Delete from database first
    db.delete(uploads).where(eq(uploads.id, upload.id)).run();

    // Delete file from disk (non-blocking, best-effort)
    await storage.delete(upload.id);

    return c.json({ ok: true });
  });

  return route;
}
