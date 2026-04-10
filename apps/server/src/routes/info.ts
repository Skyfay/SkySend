import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { toBase64url } from "@skysend/crypto";

const infoRoute = new Hono();

/**
 * GET /api/info/:id
 * Returns public upload information. No authentication required.
 * Excludes sensitive fields (tokens, storage path).
 */
infoRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const db = getDb();
  const upload = await db.query.uploads.findFirst({
    where: eq(uploads.id, id),
  });

  if (!upload) {
    return c.json({ error: "Upload not found" }, 404);
  }

  // Check if expired
  if (new Date() >= upload.expiresAt) {
    return c.json({ error: "Upload has expired" }, 410);
  }

  // Check if download limit reached
  if (upload.downloadCount >= upload.maxDownloads) {
    return c.json({ error: "Download limit reached" }, 410);
  }

  return c.json({
    id: upload.id,
    size: upload.size,
    fileCount: upload.fileCount,
    hasPassword: upload.hasPassword,
    passwordAlgo: upload.hasPassword ? upload.passwordAlgo : undefined,
    passwordSalt: upload.hasPassword && upload.passwordSalt
      ? toBase64url(new Uint8Array(upload.passwordSalt))
      : undefined,
    salt: toBase64url(new Uint8Array(upload.salt)),
    encryptedMeta: upload.encryptedMeta
      ? Buffer.from(upload.encryptedMeta).toString("base64")
      : null,
    nonce: upload.nonce
      ? Buffer.from(upload.nonce).toString("base64")
      : null,
    downloadCount: upload.downloadCount,
    maxDownloads: upload.maxDownloads,
    expiresAt: upload.expiresAt.toISOString(),
    createdAt: upload.createdAt.toISOString(),
  });
});

export { infoRoute };
