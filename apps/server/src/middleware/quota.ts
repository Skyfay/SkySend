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
 * The bytes an upload was granted when it started. Every transport ends it exactly one way:
 * commit once the upload is stored, release when it ends without being stored.
 */
export interface QuotaReservation {
  /** Records the bytes the stored upload takes and ends the reservation. */
  commit(bytes: number): void;
  /** Gives the reserved bytes back. Does nothing once the reservation has ended. */
  release(): void;
}

export type QuotaDecision =
  | { ok: true; reservation: QuotaReservation | null }
  | { ok: false; status: 413 | 429; reason: string };

/**
 * Privacy-preserving upload quota using HMAC-hashed IPs.
 * The daily rotating key ensures that IPs cannot be correlated across days.
 * State is persisted in SQLite so quotas survive server restarts.
 *
 * If FILE_UPLOAD_QUOTA_BYTES is 0, the middleware is a no-op.
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
    // L-2 (Security Audit): The HMAC key is persisted to SQLite so that quota
    // entries survive server restarts. This is an intentional trade-off.
    // In SkySend's threat model, the server owner is a TRUSTED PARTY:
    // anyone who can read the SQLite DB already has full access to all upload
    // metadata and could observe connections via the reverse proxy anyway.
    // Storing the key in RAM-only would provide no meaningful privacy improvement
    // against the realistic threat of a DB-file leak to a third party, because
    // the HMAC key rotates daily and historical data is purged on rotation.
    // The daily key rotation already prevents cross-day IP correlation,
    // which is the primary privacy goal.
    db.insert(quotaState)
      .values({ key: "hmac_key", value: hmacKey.toString("hex") })
      .onConflictDoUpdate({ target: quotaState.key, set: { value: hmacKey.toString("hex") } })
      .run();
    db.insert(quotaState)
      .values({ key: "key_created_at", value: String(keyCreatedAt) })
      .onConflictDoUpdate({ target: quotaState.key, set: { value: String(keyCreatedAt) } })
      .run();
  }

  /**
   * Bytes granted to uploads that are still running. An upload reserves its declared size
   * when it starts, so parallel uploads cannot each pass the check against the same used
   * bytes. In memory only, since no upload survives a restart. A reservation also lapses
   * when the quota window it was granted in ends, so one a transport fails to end cannot
   * block its owner for longer than the usage it stands for would have.
   */
  const held = new Set<{ hashedIp: string; bytes: number; expiresAt: number }>();

  function heldBytes(hashedIp: string): number {
    const now = Date.now();
    let bytes = 0;
    for (const entry of held) {
      if (entry.expiresAt <= now) held.delete(entry);
      else if (entry.hashedIp === hashedIp) bytes += entry.bytes;
    }
    return bytes;
  }

  // Rotate HMAC key daily for privacy
  const rotateInterval = setInterval(() => {
    hmacKey = randomBytes(32);
    keyCreatedAt = Date.now();
    db.delete(quotaUsage).run();
    held.clear();
    persistKey();
  }, keyRotationMs);
  rotateInterval.unref();

  // Periodic cleanup of expired entries
  const cleanupInterval = setInterval(() => {
    db.delete(quotaUsage).where(lt(quotaUsage.resetAt, Date.now())).run();
  }, config.FILE_UPLOAD_QUOTA_WINDOW * 1000);
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
    const resetAt = now + config.FILE_UPLOAD_QUOTA_WINDOW * 1000;
    db.insert(quotaUsage)
      .values({ hashedIp, bytesUsed: 0, resetAt })
      .onConflictDoUpdate({ target: quotaUsage.hashedIp, set: { bytesUsed: 0, resetAt } })
      .run();
    return { bytesUsed: 0, resetAt };
  }

  /** Adds the bytes of a stored upload. Only a reservation's commit calls it. */
  function recordUsage(hashedIp: string, bytes: number): void {
    if (config.FILE_UPLOAD_QUOTA_BYTES <= 0) return;
    const entry = getOrCreateEntry(hashedIp);
    const newUsed = entry.bytesUsed + bytes;
    db.update(quotaUsage)
      .set({ bytesUsed: newUsed })
      .where(eq(quotaUsage.hashedIp, hashedIp))
      .run();
  }

  /**
   * Checks an upload of `contentLength` bytes against what the IP stored and what its running
   * uploads hold, and reserves the bytes when it fits. Check and reservation run without an
   * await in between, so no other upload can pass the check in the gap. When the quota is
   * disabled, every upload may proceed and there is nothing to reserve.
   */
  function reserve(ip: string, contentLength: number): QuotaDecision {
    if (config.FILE_UPLOAD_QUOTA_BYTES <= 0) return { ok: true, reservation: null };
    const hashedIp = hashIp(ip);
    const entry = getOrCreateEntry(hashedIp);
    const used = entry.bytesUsed + heldBytes(hashedIp);
    if (used >= config.FILE_UPLOAD_QUOTA_BYTES) {
      return { ok: false, status: 429, reason: "Upload quota exceeded. Try again later." };
    }
    const bytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
    if (used + bytes > config.FILE_UPLOAD_QUOTA_BYTES) {
      return { ok: false, status: 413, reason: "File size exceeds remaining quota." };
    }

    const hold = { hashedIp, bytes, expiresAt: entry.resetAt };
    held.add(hold);
    let open = true;
    return {
      ok: true,
      reservation: {
        commit(stored: number) {
          if (!open) return;
          open = false;
          held.delete(hold);
          recordUsage(hashedIp, stored);
        },
        release() {
          if (!open) return;
          open = false;
          held.delete(hold);
        },
      },
    };
  }

  /**
   * For the request that starts an HTTP upload: the chunked init, which declares the size in
   * X-Content-Length, or the single-request upload. Never for chunk or finalize requests,
   * which belong to an upload that holds its reservation already.
   */
  const middleware = createMiddleware<{ Variables: QuotaVariables }>(async (c, next) => {
    const contentLength = parseInt(
      c.req.header("X-Content-Length") ?? c.req.header("Content-Length") ?? "0",
      10,
    );
    const decision = reserve(getClientIp(c, config.TRUST_PROXY), contentLength);
    if (!decision.ok) return c.json({ error: decision.reason }, decision.status);
    if (decision.reservation) c.set("quotaReservation", decision.reservation);
    await next();
    // A refused or failed start gives the bytes back at once. A started chunked upload keeps
    // them until its finalize or its abandonment, and a stored upload has committed already.
    if (c.res.status >= 400) decision.reservation?.release();
  });

  /**
   * Get quota status for a given Hono context (uses client IP).
   */
  function getStatus(c: Context): QuotaStatus {
    if (config.FILE_UPLOAD_QUOTA_BYTES <= 0) {
      return { enabled: false, limit: 0, used: 0, remaining: 0, resetsAt: null, window: 0 };
    }
    const ip = getClientIp(c, config.TRUST_PROXY);
    const hashedIp = hashIp(ip);
    const entry = getOrCreateEntry(hashedIp);
    // Running uploads count, so a client does not start one the quota can no longer take.
    const used = entry.bytesUsed + heldBytes(hashedIp);
    return {
      enabled: true,
      limit: config.FILE_UPLOAD_QUOTA_BYTES,
      used,
      remaining: Math.max(0, config.FILE_UPLOAD_QUOTA_BYTES - used),
      resetsAt: new Date(entry.resetAt).toISOString(),
      window: config.FILE_UPLOAD_QUOTA_WINDOW,
    };
  }

  return { middleware, getStatus, reserve };
}
