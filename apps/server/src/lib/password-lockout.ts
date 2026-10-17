/**
 * Per-resource, per-IP password attempt lockout.
 *
 * Tracks failed password attempts keyed by upload/note ID + client IP.
 * After `maxAttempts` failures from a specific IP on a specific resource,
 * that IP is locked out from that resource for `lockoutMs` milliseconds.
 *
 * Using IP+resource (not just IP or just resource) means:
 * - A brute-forcing IP does not block other IPs from accessing the same resource.
 * - A user accidentally mis-typing their password does not block others behind the same NAT.
 *
 * Privacy: IP addresses are HMAC-SHA256 hashed with an ephemeral in-memory key
 * before being used as map keys. The raw IP never appears in the store.
 * The key is generated fresh on startup and never persisted.
 */

import { createHmac, randomBytes } from "node:crypto";
import type { Context } from "hono";

// Ephemeral HMAC key - lives only in RAM, never logged or persisted
const hmacKey = randomBytes(32);

function hashIp(ip: string): string {
  return createHmac("sha256", hmacKey).update(ip).digest("hex");
}

interface LockoutEntry {
  failures: number;
  lockedUntil: number | null;
  lastFailureAt: number;
}

export interface PasswordLockout {
  /** Returns whether the resource is currently locked for this IP. */
  check(resourceKey: string, ip: string): { locked: boolean; retryAfter?: number };
  /** Increment the failure counter for this IP + resource. Locks if maxAttempts is reached. */
  recordFailure(resourceKey: string, ip: string): void;
  /** Reset the failure counter on a successful authentication. */
  recordSuccess(resourceKey: string, ip: string): void;
}

/**
 * The 429 for a resource this IP is locked out of, or null.
 *
 * The check holds only when nothing awaits between it, the token comparison and
 * `recordFailure`. Every request that passes the check before an earlier failure is recorded
 * gets its guess evaluated, and a client that holds back the last byte of its body or pipelines
 * its requests can line up as many as the rate limiter lets through. A route therefore calls
 * this once more after its last `await`, right before it compares the token.
 */
export function lockedResponse(
  c: Context,
  lockout: PasswordLockout,
  resourceKey: string,
  ip: string,
): Response | null {
  const lockState = lockout.check(resourceKey, ip);
  if (!lockState.locked) return null;
  c.header("Retry-After", String(lockState.retryAfter));
  return c.json({ error: "Too many failed attempts. Try again later." }, 429);
}

export function createPasswordLockout(maxAttempts: number, lockoutMs: number): PasswordLockout {
  const store = new Map<string, LockoutEntry>();

  // Periodic cleanup to prevent unbounded memory growth. Failures that never led to a lock
  // count for lockoutMs, so an entry for each made-up resource does not stay forever.
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      const expired =
        entry.lockedUntil !== null
          ? now >= entry.lockedUntil
          : now - entry.lastFailureAt >= lockoutMs;
      if (expired) store.delete(key);
    }
  }, lockoutMs * 2);

  cleanupInterval.unref();

  function storeKey(resourceKey: string, ip: string): string {
    return `${resourceKey}:${hashIp(ip)}`;
  }

  return {
    check(resourceKey: string, ip: string): { locked: boolean; retryAfter?: number } {
      const entry = store.get(storeKey(resourceKey, ip));
      if (!entry?.lockedUntil) return { locked: false };

      const now = Date.now();
      if (now < entry.lockedUntil) {
        return { locked: true, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
      }

      // Lockout has expired - clean up
      store.delete(storeKey(resourceKey, ip));
      return { locked: false };
    },

    recordFailure(resourceKey: string, ip: string): void {
      const key = storeKey(resourceKey, ip);
      const entry = store.get(key) ?? { failures: 0, lockedUntil: null, lastFailureAt: 0 };
      entry.failures++;
      entry.lastFailureAt = Date.now();
      if (entry.failures >= maxAttempts) {
        entry.lockedUntil = Date.now() + lockoutMs;
      }
      store.set(key, entry);
    },

    recordSuccess(resourceKey: string, ip: string): void {
      store.delete(storeKey(resourceKey, ip));
    },
  };
}
