import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { sql } from "drizzle-orm";
import { Readable } from "node:stream";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";
import type { Upload } from "../db/schema.js";
import type { StorageBackend } from "../storage/types.js";
import type { PasswordLockout } from "../lib/password-lockout.js";
import { getConfig } from "../lib/config.js";
import { getClientIp } from "../middleware/rate-limit.js";

export function createDownloadRoute(storage: StorageBackend, lockout: PasswordLockout) {
  const route = new Hono<{
    Variables: { upload: Upload };
  }>();

  /**
   * The auth token of a password-protected upload comes from the password, so a wrong token is
   * a wrong guess. It counts against the same lockout as POST /api/password/:id, under the same
   * key, so a guesser cannot switch to the download to get around it (GHSA-rxxj-c5wr-phqp).
   */
  const guessLimit = createMiddleware(async (c, next) => {
    const ip = getClientIp(c, getConfig().TRUST_PROXY);
    const resourceKey = `file:${c.req.param("id")}`;
    const lockState = lockout.check(resourceKey, ip);
    if (lockState.locked) {
      c.header("Retry-After", String(lockState.retryAfter));
      return c.json({ error: "Too many failed attempts. Try again later." }, 429);
    }
    await next();
    // Only a token that was sent is a guess. A request without one, such as an image tag on
    // another site pointing here, must not lock the visitor out.
    if (c.res.status === 401 && c.req.header("X-Auth-Token")) lockout.recordFailure(resourceKey, ip);
    else if (c.res.ok) lockout.recordSuccess(resourceKey, ip);
  });

  /**
   * GET /api/download/:id
   * Streams the encrypted file to the client.
   * Requires valid auth token. Increments download count atomically.
   */
  route.get("/:id", guessLimit, authMiddleware, async (c) => {
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

    // S3 backend: generate presigned URL for direct client download
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
