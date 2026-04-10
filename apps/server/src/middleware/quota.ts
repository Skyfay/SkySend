import { createMiddleware } from "hono/factory";
import { createHmac, randomBytes } from "node:crypto";
import type { Config } from "../lib/config.js";
import { getClientIp } from "./rate-limit.js";

interface QuotaEntry {
  bytesUsed: number;
  resetAt: number;
}

/**
 * Privacy-preserving upload quota using HMAC-hashed IPs.
 * The daily rotating key ensures that IPs cannot be correlated across days.
 *
 * If UPLOAD_QUOTA_BYTES is 0, the middleware is a no-op.
 */
export function createUploadQuota(config: Config) {
  const store = new Map<string, QuotaEntry>();
  let hmacKey = randomBytes(32);


  // Rotate HMAC key daily for privacy
  const keyRotationMs = 24 * 60 * 60 * 1000;
  const rotateInterval = setInterval(() => {
    hmacKey = randomBytes(32);
    store.clear();
  }, keyRotationMs);
  rotateInterval.unref();

  // Periodic cleanup of expired entries
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
  }, config.UPLOAD_QUOTA_WINDOW * 1000);
  cleanupInterval.unref();

  function hashIp(ip: string): string {
    return createHmac("sha256", hmacKey).update(ip).digest("hex");
  }

  function getOrCreateEntry(hashedIp: string): QuotaEntry {
    const now = Date.now();
    let entry = store.get(hashedIp);
    if (!entry || now >= entry.resetAt) {
      entry = { bytesUsed: 0, resetAt: now + config.UPLOAD_QUOTA_WINDOW * 1000 };
      store.set(hashedIp, entry);
    }
    return entry;
  }

  const middleware = createMiddleware(async (c, next) => {
    // Quota disabled
    if (config.UPLOAD_QUOTA_BYTES <= 0) {
      await next();
      return;
    }

    const ip = getClientIp(c.req.raw);
    const hashedIp = hashIp(ip);
    const entry = getOrCreateEntry(hashedIp);

    // Check quota before accepting upload
    if (entry.bytesUsed >= config.UPLOAD_QUOTA_BYTES) {
      return c.json(
        { error: "Upload quota exceeded. Try again later." },
        429,
      );
    }

    // Store hashed IP in context for post-upload tracking
    c.set("quotaHashedIp" as never, hashedIp);
    await next();
  });

  /**
   * Record bytes used after a successful upload.
   */
  function recordUsage(hashedIp: string, bytes: number): void {
    if (config.UPLOAD_QUOTA_BYTES <= 0) return;
    const entry = getOrCreateEntry(hashedIp);
    entry.bytesUsed += bytes;
  }

  return { middleware, recordUsage };
}
