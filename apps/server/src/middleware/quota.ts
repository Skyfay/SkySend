import { createMiddleware } from "hono/factory";
import { createHmac, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { eq, lt, sum } from "drizzle-orm";
import type { Config } from "../lib/config.js";
import { getDb } from "../db/index.js";
import { quotaUsage, quotaState, uploads, requestUploads } from "../db/schema.js";
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
 * The answer to an upload that STORAGE_MAX_SIZE has no room for. It names neither the used nor
 * the free space, so a refusal tells a client no more than that this one upload does not fit.
 * It says so apart from the size errors, since the upload may be far below FILE_MAX_SIZE.
 * The web app recognises the text, keep it when the code around it moves.
 */
export const STORAGE_FULL_MESSAGE =
  "This instance does not have enough free storage for this upload right now. Try again later.";

/**
 * The bytes an upload was granted when it started, against the upload quota of its sender and
 * the storage limit of the instance. Every transport ends it exactly one way: commit once the
 * upload is stored, release when it ends without being stored.
 */
export interface QuotaReservation {
  /** Records the bytes the stored upload takes and ends the reservation. */
  commit(bytes: number): void;
  /** Gives the reserved bytes back. Does nothing once the reservation has ended. */
  release(): void;
}

export type QuotaDecision =
  | { ok: true; reservation: QuotaReservation | null }
  | { ok: false; status: 413 | 429 | 507; reason: string };

/**
 * Privacy-preserving upload quota using HMAC-hashed IPs.
 * The daily rotating key ensures that IPs cannot be correlated across days.
 * Usage is kept in SQLite, the key only in memory, so a restart starts every budget afresh.
 *
 * It also holds the storage limit of the instance (STORAGE_MAX_SIZE), since an upload has to fit
 * both and reserves both in one step.
 *
 * If FILE_UPLOAD_QUOTA_BYTES and STORAGE_MAX_SIZE are both 0, the middleware is a no-op.
 */
export function createUploadQuota(config: Config) {
  const keyRotationMs = 24 * 60 * 60 * 1000;

  // The key never touches the disk. Releases up to 3.2.0 kept it in quota_state next to the
  // hashes, so anyone with a copy of the database or a backup recovered every IPv4 address
  // in it by trying all 2^32, and matched them to uploads by their size. Without the key the
  // stored hashes are worthless, so they go too, and so does a key an older release left.
  let hmacKey = randomBytes(32);
  const db = getDb();
  db.delete(quotaUsage).run();
  db.delete(quotaState).run();

  /**
   * Bytes granted to uploads that are still running. An upload reserves its declared size
   * when it starts, so parallel uploads cannot each pass the check against the same used
   * bytes. In memory only, since no upload survives a restart. A reservation also lapses
   * when the quota window it was granted in ends, so one a transport fails to end cannot
   * block its owner for longer than the usage it stands for would have.
   */
  const held = new Set<{ hashedIp: string; bytes: number; expiresAt: number }>();

  /**
   * Bytes granted to running uploads against STORAGE_MAX_SIZE. Like `held` it lives in memory
   * only, but it never lapses: an upload may run for hours, and a lapsed hold would let parallel
   * uploads overshoot the limit together. Every transport ends its reservation exactly once.
   */
  let storageHeld = 0;

  /**
   * What the stored files take: the sizes of all uploads and uploads into a request, read
   * instead of kept in a counter, so deleting and cleaning up never have to keep one in step.
   * Notes live in the database, not in the storage backend, so they do not count. An expired
   * upload counts until the cleanup removes it.
   */
  function storedBytes(): number {
    const files = db.select({ bytes: sum(uploads.size) }).from(uploads).get();
    const received = db.select({ bytes: sum(requestUploads.size) }).from(requestUploads).get();
    return Number(files?.bytes ?? 0) + Number(received?.bytes ?? 0);
  }

  /**
   * Whether STORAGE_MAX_SIZE has less room left than FILE_MAX_SIZE beside the stored files and
   * the running uploads, so an upload of the size the instance advertises may be refused.
   * /api/config reports it as this one bit and never as a number: whoever polls the bit sees
   * only when it flips, and a refused start tells about as much.
   */
  function storageLow(): boolean {
    if (config.STORAGE_MAX_SIZE <= 0) return false;
    return config.STORAGE_MAX_SIZE - storedBytes() - storageHeld < config.FILE_MAX_SIZE;
  }

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
    db.delete(quotaUsage).run();
    held.clear();
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
   * uploads hold, then against the storage limit of the instance, and reserves the bytes in
   * both when it fits. Checks and reservation run without an await in between, so no other
   * upload can pass a check in the gap. The quota of the sender comes first, so a sender over
   * it learns nothing about the space of the instance. When both are disabled, every upload may
   * proceed and there is nothing to reserve.
   */
  function reserve(ip: string, contentLength: number): QuotaDecision {
    const quotaOn = config.FILE_UPLOAD_QUOTA_BYTES > 0;
    const limitOn = config.STORAGE_MAX_SIZE > 0;
    if (!quotaOn && !limitOn) return { ok: true, reservation: null };
    const bytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;

    let hold: { hashedIp: string; bytes: number; expiresAt: number } | null = null;
    if (quotaOn) {
      const hashedIp = hashIp(ip);
      const entry = getOrCreateEntry(hashedIp);
      const used = entry.bytesUsed + heldBytes(hashedIp);
      if (used >= config.FILE_UPLOAD_QUOTA_BYTES) {
        return { ok: false, status: 429, reason: "Upload quota exceeded. Try again later." };
      }
      if (used + bytes > config.FILE_UPLOAD_QUOTA_BYTES) {
        return { ok: false, status: 413, reason: "File size exceeds remaining quota." };
      }
      hold = { hashedIp, bytes, expiresAt: entry.resetAt };
    }
    if (limitOn && storedBytes() + storageHeld + bytes > config.STORAGE_MAX_SIZE) {
      return { ok: false, status: 507, reason: STORAGE_FULL_MESSAGE };
    }

    if (hold) held.add(hold);
    const storageBytes = limitOn ? bytes : 0;
    storageHeld += storageBytes;
    let open = true;
    /** Ends both holds. A stored upload counts through its row from here on. */
    const end = () => {
      open = false;
      if (hold) held.delete(hold);
      storageHeld -= storageBytes;
    };
    return {
      ok: true,
      reservation: {
        commit(stored: number) {
          if (!open) return;
          end();
          if (hold) recordUsage(hold.hashedIp, stored);
        },
        release() {
          if (!open) return;
          end();
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

  return { middleware, getStatus, reserve, storageLow };
}
