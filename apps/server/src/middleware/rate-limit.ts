import { isIP } from "node:net";
import { createMiddleware } from "hono/factory";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { Config } from "../lib/config.js";
import { DEFAULT_TRUSTED_PROXIES, trustedProxyList } from "../lib/trusted-proxies.js";

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
 * Whether a request passes the global limiter uncounted: only the chunks of a chunked upload,
 * which lib/chunked-upload.ts bounds instead. Every request that opens an upload is counted,
 * the init of a chunked upload and the upgrade of a WebSocket upload alike, for normal uploads
 * and uploads into a file request (GHSA-rmc2-p8pp-4vmh).
 */
export function skipsRateLimit(path: string): boolean {
  return /\/upload\/[^/]+\/chunk$/.test(path);
}

/** The eight 16-bit groups of a valid IPv6 address, an IPv4 tail like ::ffff:1.2.3.4 included. */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase();
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", rest] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = rest === undefined || rest === "" ? [] : rest.split(":");
  const fill = rest === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...fill, ...right].map((group) => parseInt(group, 16));
}

/**
 * The form of a client address that the limits count by: the rate limiter, the upload quota,
 * the password lockout and the daily request limit. A client on IPv6 usually holds a whole
 * /64, one household, phone or server, and could take a new address from it for every request,
 * so an IPv6 address counts as its /64 network. An IPv4 address mapped into IPv6 counts as that
 * IPv4 address. Anything that is no address, like "unknown", stays as it is.
 */
export function toLimitKey(ip: string): string {
  const address = ip.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6) return ip;
  const groups = ipv6Groups(address);
  const mapped = groups.slice(0, 6).every((group, i) => (i === 5 ? group === 0xffff : group === 0));
  if (mapped) {
    const [high = 0, low = 0] = groups.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

let trustedProxies = trustedProxyList(DEFAULT_TRUSTED_PROXIES);
let warnedUntrustedProxy = false;

/** Replaces the networks whose forwarded headers count, from TRUSTED_PROXIES. */
export function setTrustedProxies(entries: string[]): void {
  trustedProxies = trustedProxyList(entries);
}

/**
 * Extract the client IP from the request, in the form the limits count by (see toLimitKey).
 * Only trusts proxy headers (X-Forwarded-For, X-Real-IP) when TRUST_PROXY is enabled and the
 * request comes from a trusted proxy. Falls back to Node.js socket info via getConnInfo.
 *
 * S-1 (Security Audit): When TRUST_PROXY is enabled, we take the RIGHTMOST value from
 * X-Forwarded-For, not the leftmost. The rightmost entry is appended by the trusted
 * reverse proxy and reflects the actual client IP as seen by the proxy.
 * The leftmost entries are client-controlled and can be spoofed freely.
 * Example: X-Forwarded-For: <spoofed>, <real-client-ip>  → we use <real-client-ip>.
 *
 * The headers count only when the socket comes from a network in TRUSTED_PROXIES. The setup
 * the docs showed published the server's port on every interface besides the proxy, so anyone
 * who reached the port directly sent a new X-Forwarded-For with every guess and was never
 * locked out. A forwarded value that is no address falls back to the socket too, or every
 * string would have been a client of its own.
 */
function getClientIp(c: Context, trustProxy = false): string {
  return toLimitKey(rawClientIp(c, trustProxy));
}

function rawClientIp(c: Context, trustProxy: boolean): string {
  const socket = socketAddress(c);
  if (trustProxy) {
    const forwarded = forwardedAddress(c);
    if (forwarded && socket && isTrustedProxy(socket)) return forwarded;
    if (forwarded && !warnedUntrustedProxy) {
      warnedUntrustedProxy = true;
      console.warn(
        "[skysend] Ignoring X-Forwarded-For and X-Real-IP from a connection outside TRUSTED_PROXIES. " +
          "If your reverse proxy connects from a public address, add it to TRUSTED_PROXIES.",
      );
    }
  }
  return socket ?? "unknown";
}

/** The address the socket of the request comes from. */
function socketAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address || undefined;
  } catch {
    // getConnInfo fails without the bindings of @hono/node-server, as in app.request() of tests
    return undefined;
  }
}

/**
 * The client address the proxy forwarded: the rightmost entry of X-Forwarded-For, or X-Real-IP.
 * A port some proxies append ("203.0.113.7:51234", "[2001:db8::1]:443") is dropped.
 */
function forwardedAddress(c: Context): string | undefined {
  const value = c.req.header("X-Forwarded-For")?.split(",").at(-1)?.trim() || c.req.header("X-Real-IP")?.trim();
  if (!value) return undefined;
  const address = /^\[([^\]]+)\](?::\d+)?$/.exec(value)?.[1] ?? value.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1");
  return isIP(address) ? address : undefined;
}

function isTrustedProxy(address: string): boolean {
  const plain = address.split("%")[0] ?? "";
  // A dual-stack socket reports an IPv4 peer as ::ffff:a.b.c.d.
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(plain)?.[1];
  if (v4) return trustedProxies.check(v4, "ipv4");
  return trustedProxies.check(plain, isIP(plain) === 6 ? "ipv6" : "ipv4");
}

export { getClientIp };
