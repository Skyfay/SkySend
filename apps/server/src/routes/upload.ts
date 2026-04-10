import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/index.js";
import { uploads } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { fromBase64url, SALT_LENGTH } from "@skysend/crypto";
import type { FileStorage } from "../storage/filesystem.js";

const base64urlPattern = /^[A-Za-z0-9_-]+$/;

const uploadHeadersSchema = z.object({
  authToken: z.string().regex(base64urlPattern, "Invalid base64url"),
  ownerToken: z.string().regex(base64urlPattern, "Invalid base64url"),
  salt: z.string().regex(base64urlPattern, "Invalid base64url"),
  maxDownloads: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  expireSec: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  fileCount: z
    .string()
    .default("1")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  contentLength: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
  hasPassword: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  passwordSalt: z.string().regex(base64urlPattern).optional(),
  passwordAlgo: z.enum(["argon2id", "pbkdf2"]).optional(),
});

export function createUploadRoute(storage: FileStorage) {
  const route = new Hono();

  /**
   * POST /api/upload
   * Streams the encrypted file body to disk and creates a database record.
   * All metadata is passed via headers - the body is the raw encrypted stream.
   */
  route.post("/", async (c) => {
    const config = getConfig();

    // Parse and validate headers
    const headerResult = uploadHeadersSchema.safeParse({
      authToken: c.req.header("X-Auth-Token"),
      ownerToken: c.req.header("X-Owner-Token"),
      salt: c.req.header("X-Salt"),
      maxDownloads: c.req.header("X-Max-Downloads"),
      expireSec: c.req.header("X-Expire-Sec"),
      fileCount: c.req.header("X-File-Count"),
      contentLength: c.req.header("Content-Length"),
      hasPassword: c.req.header("X-Has-Password"),
      passwordSalt: c.req.header("X-Password-Salt") || undefined,
      passwordAlgo: c.req.header("X-Password-Algo") || undefined,
    });

    if (!headerResult.success) {
      return c.json(
        { error: "Invalid request headers", details: headerResult.error.flatten().fieldErrors },
        400,
      );
    }

    const headers = headerResult.data;

    // Validate salt length
    try {
      const saltBytes = fromBase64url(headers.salt);
      if (saltBytes.length !== SALT_LENGTH) {
        return c.json({ error: `Salt must be exactly ${SALT_LENGTH} bytes` }, 400);
      }
    } catch {
      return c.json({ error: "Invalid salt encoding" }, 400);
    }

    // Validate against server limits
    if (headers.contentLength > config.MAX_FILE_SIZE) {
      return c.json(
        { error: `File size exceeds maximum of ${config.MAX_FILE_SIZE} bytes` },
        413,
      );
    }

    if (headers.fileCount > config.MAX_FILES_PER_UPLOAD) {
      return c.json(
        { error: `Maximum ${config.MAX_FILES_PER_UPLOAD} files per upload` },
        400,
      );
    }

    if (!config.EXPIRE_OPTIONS_SEC.includes(headers.expireSec)) {
      return c.json(
        { error: "Invalid expiry time. Must be one of the allowed options." },
        400,
      );
    }

    if (!config.DOWNLOAD_OPTIONS.includes(headers.maxDownloads)) {
      return c.json(
        { error: "Invalid download limit. Must be one of the allowed options." },
        400,
      );
    }

    // Validate password fields
    if (headers.hasPassword) {
      if (!headers.passwordSalt || !headers.passwordAlgo) {
        return c.json(
          { error: "Password-protected uploads require X-Password-Salt and X-Password-Algo" },
          400,
        );
      }
    }

    // Ensure we have a request body
    const body = c.req.raw.body;
    if (!body) {
      return c.json({ error: "Missing request body" }, 400);
    }

    const id = randomUUID();
    const storagePath = `${id}.bin`;

    // Stream the encrypted body to disk
    let bytesWritten: number;
    try {
      bytesWritten = await storage.save(id, body);
    } catch (err) {
      // Clean up partial file on error
      await storage.delete(id).catch(() => {});
      throw err;
    }

    // Verify the actual bytes match Content-Length
    if (bytesWritten !== headers.contentLength) {
      await storage.delete(id).catch(() => {});
      return c.json(
        { error: "Body size does not match Content-Length header" },
        400,
      );
    }

    // Decode password salt if present
    let passwordSaltBuffer: Buffer | null = null;
    if (headers.hasPassword && headers.passwordSalt) {
      passwordSaltBuffer = Buffer.from(fromBase64url(headers.passwordSalt));
    }

    // Create database record
    const now = new Date();
    const expiresAt = new Date(now.getTime() + headers.expireSec * 1000);

    const db = getDb();
    db.insert(uploads).values({
      id,
      ownerToken: headers.ownerToken,
      authToken: headers.authToken,
      salt: Buffer.from(fromBase64url(headers.salt)),
      size: bytesWritten,
      fileCount: headers.fileCount,
      hasPassword: headers.hasPassword,
      passwordSalt: passwordSaltBuffer,
      passwordAlgo: headers.hasPassword ? (headers.passwordAlgo ?? null) : null,
      maxDownloads: headers.maxDownloads,
      downloadCount: 0,
      expiresAt,
      createdAt: now,
      storagePath,
    }).run();

    // Record quota usage if applicable
    const quotaHashedIp = c.get("quotaHashedIp" as never) as string | undefined;
    if (quotaHashedIp) {
      const quotaRecorder = c.get("quotaRecorder" as never) as
        | ((ip: string, bytes: number) => void)
        | undefined;
      if (quotaRecorder) {
        quotaRecorder(quotaHashedIp, bytesWritten);
      }
    }

    return c.json({
      id,
      url: `${config.BASE_URL}/#${id}`,
    }, 201);
  });

  return route;
}
