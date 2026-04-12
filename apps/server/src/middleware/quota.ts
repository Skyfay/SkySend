import { createMiddleware } from "hono/factory";
import { createHmac, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { eq, lt } from "drizzle-orm";
import type { Config } from "../lib/config.js";
import { getDb } from "../db/index.js";
import { quotaUsage, quotaState } from "../db/schema.js";
import { getClientIp } from "./rate-limit.js";
import type { QuotaVariables } from "../types.js";

export interface QuotaStatus {
  enabled: boolean;
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string | null;
  window: number;
}

/**
 * Privacy-preserving upload quota using HMAC-hashed IPs.
 * The daily rotating key ensures that IPs cannot be correlated across days.
 * State is persisted in SQLite so quotas survive server restarts.
 *
 * If UPLOAD_QUOTA_BYTES is 0, the middleware is a no-op.
 */
export function createUploadQuota(config: Config) {
  const keyRotationMs = 24 * 60 * 60 * 1000;

  let hmacKey: Buffer;
  let keyCreatedAt: number;

  // Try to restore HMAC key from DB
  const db = getDb();
  const storedKey = db.select().from(quotaState).where(eq(quotaState.key, "hmac_key")).get();
  const storedKeyTime = db.select().from(quotaState).where(eq(quotaState.key, "key_created_at")).get();
  const now = Date.now();

  if (storedKey && storedKeyTime && (now - Number(storedKeyTime.value)) < keyRotationMs) {
    hmacKey = Buffer.from(storedKey.value, "hex");
    keyCreatedAt = Number(storedKeyTime.value);
    // Clean up expired entries
    db.delete(quotaUsage).where(lt(quotaUsage.resetAt, now)).run();
    const remaining = db.select().from(quotaUsage).all().length;
    console.log(`[quota] Restored ${remaining} entries from database`);
  } else {
    // Fresh key - clear all usage entries
    hmacKey = randomBytes(32);
    keyCreatedAt = now;
    db.delete(quotaUsage).run();
    persistKey();
  }

  function persistKey(): void {
    db.insert(quotaState)
      .values({ key: "hmac_key", value: hmacKey.toString("hex") })
      .onConflictDoUpdate({ target: quotaState.key, set: { value: hmacKey.toString("hex") } })
      .run();
    db.insert(quotaState)
      .values({ key: "key_created_at", value: String(keyCreatedAt) })
      .onConflictDoUpdate({ target: quotaState.key, set: { value: String(keyCreatedAt) } })
      .run();
  }

  // Rotate HMAC key daily for privacy
  const rotateInterval = setInterval(() => {
    hmacKey = randomBytes(32);
    keyCreatedAt = Date.now();
    db.delete(quotaUsage).run();
    persistKey();
  }, keyRotationMs);
  rotateInterval.unref();

  // Periodic cleanup of expired entries
  const cleanupInterval = setInterval(() => {
    db.delete(quotaUsage).where(lt(quotaUsage.resetAt, Date.now())).run();
  }, config.UPLOAD_QUOTA_WINDOW * 1000);
  cleanupInterval.unref();

  function hashIp(ip: string): string {
    return createHmac("sha256", hmacKey).update(ip).digest("hex");
  }

  function getOrCreateEntry(hashedIp: string): { bytesUsed: number; resetAt: number } {
    const now = Date.now();
    const existing = db.select().from(quotaUsage).where(eq(quotaUsage.hashedIp, hashedIp)).get();

    if (existing && now < existing.resetAt) {
      return { bytesUsed: existing.bytesUsed, resetAt: existing.resetAt };
    }

    // Create or reset entry
    const resetAt = now + config.UPLOAD_QUOTA_WINDOW * 1000;
    db.insert(quotaUsage)
      .values({ hashedIp, bytesUsed: 0, resetAt })
      .onConflictDoUpdate({ target: quotaUsage.hashedIp, set: { bytesUsed: 0, resetAt } })
      .run();
    return { bytesUsed: 0, resetAt };
  }

  const middleware = createMiddleware<{ Variables: QuotaVariables }>(async (c, next) => {
    // Quota disabled
    if (config.UPLOAD_QUOTA_BYTES <= 0) {
      await next();
      return;
    }

    const ip = getClientIp(c, config.TRUST_PROXY);
    const hashedIp = hashIp(ip);
    const entry = getOrCreateEntry(hashedIp);

    // Check quota before accepting upload
    if (entry.bytesUsed >= config.UPLOAD_QUOTA_BYTES) {
      return c.json(
        { error: "Upload quota exceeded. Try again later." },
        429,
      );
    }

    // Reject uploads that would exceed the remaining quota
    // X-Content-Length is used for chunked uploads (init declares total size)
    const contentLength = parseInt(
      c.req.header("X-Content-Length") ?? c.req.header("Content-Length") ?? "0",
      10,
    );
    if (contentLength > 0 && entry.bytesUsed + contentLength > config.UPLOAD_QUOTA_BYTES) {
      return c.json(
        { error: "File size exceeds remaining quota." },
        413,
      );
    }

    // Store hashed IP in context for post-upload tracking
    c.set("quotaHashedIp", hashedIp);
    await next();
  });

  /**
   * Record bytes used after a successful upload.
   */
  function recordUsage(hashedIp: string, bytes: number): void {
    if (config.UPLOAD_QUOTA_BYTES <= 0) return;
    const entry = getOrCreateEntry(hashedIp);
    const newUsed = entry.bytesUsed + bytes;
    db.update(quotaUsage)
      .set({ bytesUsed: newUsed })
      .where(eq(quotaUsage.hashedIp, hashedIp))
      .run();
  }

  /**
   * Get quota status for a given Hono context (uses client IP).
   */
  function getStatus(c: Context): QuotaStatus {
    if (config.UPLOAD_QUOTA_BYTES <= 0) {
      return { enabled: false, limit: 0, used: 0, remaining: 0, resetsAt: null, window: 0 };
    }
    const ip = getClientIp(c, config.TRUST_PROXY);
    const hashedIp = hashIp(ip);
    const entry = getOrCreateEntry(hashedIp);
    return {
      enabled: true,
      limit: config.UPLOAD_QUOTA_BYTES,
      used: entry.bytesUsed,
      remaining: Math.max(0, config.UPLOAD_QUOTA_BYTES - entry.bytesUsed),
      resetsAt: new Date(entry.resetAt).toISOString(),
      window: config.UPLOAD_QUOTA_WINDOW,
    };
  }

  return { middleware, recordUsage, getStatus };
}
