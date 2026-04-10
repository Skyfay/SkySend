import { createMiddleware } from "hono/factory";
import type { Config } from "../lib/config.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory rate limiter using a sliding window approach.
 * Entries are lazily cleaned up when accessed.
 */
export function createRateLimiter(config: Config) {
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup to prevent unbounded memory growth
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
  }, config.RATE_LIMIT_WINDOW * 2);

  // Allow cleanup interval to not keep the process alive
  cleanupInterval.unref();

  return createMiddleware(async (c, next) => {
    const ip = getClientIp(c.req.raw, config.TRUST_PROXY);
    const now = Date.now();

    let entry = store.get(ip);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + config.RATE_LIMIT_WINDOW };
      store.set(ip, entry);
    }

    entry.count++;

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(config.RATE_LIMIT_MAX));
    c.header("X-RateLimit-Remaining", String(Math.max(0, config.RATE_LIMIT_MAX - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > config.RATE_LIMIT_MAX) {
      return c.json(
        { error: "Too many requests" },
        429,
      );
    }

    await next();
  });
}

/**
 * Extract the client IP from the request.
 * Only trusts proxy headers (X-Forwarded-For, X-Real-IP) when TRUST_PROXY is enabled.
 */
function getClientIp(request: Request, trustProxy = false): string {
  if (trustProxy) {
    // Check X-Forwarded-For first (most common with reverse proxies)
    const forwarded = request.headers.get("X-Forwarded-For");
    if (forwarded) {
      // Take the first (leftmost) IP - the original client
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }

    // Check X-Real-IP (used by Nginx)
    const realIp = request.headers.get("X-Real-IP");
    if (realIp) return realIp.trim();
  }

  // Fallback: use a default since Hono doesn't expose socket info directly
  return "unknown";
}

export { getClientIp };
