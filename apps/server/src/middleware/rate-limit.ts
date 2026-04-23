import { createMiddleware } from "hono/factory";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { Config } from "../lib/config.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory rate limiter using a sliding window approach.
 * Entries are lazily cleaned up when accessed.
 *
 * S-3 (Security Audit): This store is intentionally in-memory (not Redis/Valkey).
 * SkySend is designed as a single-instance, self-hosted tool. A persistent external
 * store would be over-engineering for the typical deployment model. If multi-instance
 * deployments are needed, rate limiting should be handled at the reverse proxy layer
 * (Nginx, Traefik, Cloudflare) which is better suited for distributed enforcement.
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
    const ip = getClientIp(c, config.TRUST_PROXY);
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
 * Falls back to Node.js socket info via getConnInfo.
 *
 * S-1 (Security Audit): When TRUST_PROXY is enabled, we take the RIGHTMOST value from
 * X-Forwarded-For, not the leftmost. The rightmost entry is appended by the trusted
 * reverse proxy and reflects the actual client IP as seen by the proxy.
 * The leftmost entries are client-controlled and can be spoofed freely.
 * Example: X-Forwarded-For: <spoofed>, <real-client-ip>  → we use <real-client-ip>.
 */
function getClientIp(c: Context, trustProxy = false): string {
  if (trustProxy) {
    const forwarded = c.req.header("X-Forwarded-For");
    if (forwarded) {
      // Rightmost IP is appended by the trusted reverse proxy.
      // Leftmost IPs can be spoofed by the client.
      const trusted = forwarded.split(",").at(-1)?.trim();
      if (trusted) return trusted;
    }

    const realIp = c.req.header("X-Real-IP");
    if (realIp) return realIp.trim();
  }

  // Use Node.js socket info for the actual remote address
  try {
    const info = getConnInfo(c);
    if (info.remote.address) return info.remote.address;
  } catch {
    // getConnInfo may fail in test environments
  }

  return "unknown";
}

export { getClientIp };
