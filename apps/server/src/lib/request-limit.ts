/**
 * How many file requests one person may create per day, counted by OIDC user or client IP.
 *
 * In memory, like the rate limiter: the server is single-instance, and a restart only
 * resets the day early. Identities are HMAC-hashed with a key that lives only in RAM, so
 * neither an IP nor an OIDC subject is ever kept as it is.
 */

import { createHmac, randomBytes } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RequestLimiter {
  /** Counts one new request for this identity. False when the daily limit is used up. */
  take(identity: string): boolean;
  /**
   * How many this identity has left, and when its day ends, without counting one. The end is
   * null while it made none yet, and all of it is null while the limit is off.
   */
  peek(identity: string): { remaining: number; resetsAt: number | null } | null;
}

export function createRequestLimiter(dailyLimit: number): RequestLimiter {
  const hmacKey = randomBytes(32);
  const store = new Map<string, { count: number; resetAt: number }>();

  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of store) {
        if (now >= entry.resetAt) store.delete(key);
      }
    },
    60 * 60 * 1000,
  ).unref();

  const keyOf = (identity: string) => createHmac("sha256", hmacKey).update(identity).digest("hex");

  return {
    take(identity) {
      if (dailyLimit <= 0) return true;
      const key = keyOf(identity);
      const now = Date.now();
      let entry = store.get(key);
      if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + DAY_MS };
        store.set(key, entry);
      }
      if (entry.count >= dailyLimit) return false;
      entry.count++;
      return true;
    },

    peek(identity) {
      if (dailyLimit <= 0) return null;
      const entry = store.get(keyOf(identity));
      if (!entry || Date.now() >= entry.resetAt) return { remaining: dailyLimit, resetsAt: null };
      return { remaining: Math.max(0, dailyLimit - entry.count), resetsAt: entry.resetAt };
    },
  };
}
