import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { Readable } from "node:stream";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";
import type { Upload } from "../db/schema.js";
import type { StorageBackend } from "../storage/types.js";

export function createDownloadRoute(storage: StorageBackend) {
  const route = new Hono<{
    Variables: { upload: Upload };
  }>();

  /**
   * GET /api/download/:id
   * Streams the encrypted file to the client.
   * Requires valid auth token. Increments download count atomically.
   */
  route.get("/:id", authMiddleware, async (c) => {
    const upload = c.get("upload");

    // Check if expired
    if (new Date() >= upload.expiresAt) {
      return c.json({ error: "Upload has expired" }, 410);
    }

    // Check if download limit reached
    if (upload.downloadCount >= upload.maxDownloads) {
      return c.json({ error: "Download limit reached" }, 410);
    }

    // Verify file exists on disk
    const fileExists = await storage.exists(upload.id);
    if (!fileExists) {
      return c.json({ error: "File not found on disk" }, 500);
    }

    // Atomically increment download count and verify the record still qualifies
    const db = getDb();
    const result = db
      .update(uploads)
      .set({
        downloadCount: sql`${uploads.downloadCount} + 1`,
      })
      .where(
        sql`${uploads.id} = ${upload.id} AND ${uploads.downloadCount} < ${uploads.maxDownloads}`,
      )
      .run();

    if (result.changes === 0) {
      return c.json({ error: "Upload no longer available" }, 410);
    }

    // S3 backend with public URL: return direct URL
    const publicUrl = storage.getPublicDownloadUrl(upload.id);
    if (publicUrl) {
      return c.json({
        url: publicUrl,
        size: upload.size,
        fileCount: upload.fileCount,
      });
    }

    // S3 backend with presigned URL: generate signed URL
    if (storage.supportsPresignedUrls()) {
      const url = await storage.getPresignedDownloadUrl(upload.id);
      return c.json({
        url,
        size: upload.size,
        fileCount: upload.fileCount,
      });
    }

    // Filesystem backend: stream the file directly
    const nodeStream = storage.createReadStream(upload.id);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(upload.size),
        "Cache-Control": "no-store",
        "X-File-Count": String(upload.fileCount),
      },
    });
  });

  return route;
}
