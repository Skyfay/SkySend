import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { eq, sql } from "drizzle-orm";
import { Readable } from "node:stream";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { constantTimeEqual, fromBase64url } from "@skysend/crypto";
import type { Upload } from "../db/schema.js";
import type { StorageBackend } from "../storage/types.js";
import { lockedResponse, type PasswordLockout } from "../lib/password-lockout.js";
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
   *
   * This is authMiddleware with the lockout inside it: the lockout is checked again after the
   * lookup, right before the comparison, and the failure is recorded right after it, with no
   * await in between. A check that ran before the lookup let pipelined guesses all pass it.
   */
  const guessLimitedAuth = createMiddleware<{ Variables: { upload: Upload } }>(async (c, next) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Missing upload ID" }, 400);
    const ip = getClientIp(c, getConfig().TRUST_PROXY);
    const resourceKey = `file:${id}`;
    const locked = lockedResponse(c, lockout, resourceKey, ip);
    if (locked) return locked;

    // Only a token that was sent is a guess. A request without one, such as an image tag on
    // another site pointing here, must not lock the visitor out.
    const tokenHeader = c.req.header("X-Auth-Token");
    if (!tokenHeader) return c.json({ error: "Missing X-Auth-Token header" }, 401);

    const upload = await getDb().query.uploads.findFirst({ where: eq(uploads.id, id) });
    if (!upload) return c.json({ error: "Upload not found" }, 404);

    const lockedNow = lockedResponse(c, lockout, resourceKey, ip);
    if (lockedNow) return lockedNow;

    let providedToken: Uint8Array;
    try {
      providedToken = fromBase64url(tokenHeader);
    } catch {
      lockout.recordFailure(resourceKey, ip);
      return c.json({ error: "Invalid auth token format" }, 401);
    }
    if (!constantTimeEqual(providedToken, fromBase64url(upload.authToken))) {
      lockout.recordFailure(resourceKey, ip);
      return c.json({ error: "Invalid auth token" }, 401);
    }
    lockout.recordSuccess(resourceKey, ip);

    c.set("upload", upload);
    await next();
  });

  /**
   * GET /api/download/:id
   * Streams the encrypted file to the client.
   * Requires valid auth token. Increments download count atomically.
   */
  route.get("/:id", guessLimitedAuth, async (c) => {
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
