import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createRateLimiter, getClientIp } from "../src/middleware/rate-limit.js";
import type { Config } from "../src/lib/config.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    PORT: 3000,
    HOST: "0.0.0.0",
    BASE_URL: "http://localhost:3000",
    DATA_DIR: "./data",
    MAX_FILE_SIZE: 2 * 1024 ** 3,
    EXPIRE_OPTIONS_SEC: [300, 3600, 86400],
    DEFAULT_EXPIRE_SEC: 86400,
    DOWNLOAD_OPTIONS: [1, 5, 10],
    DEFAULT_DOWNLOAD: 1,
    CLEANUP_INTERVAL: 60,
    SITE_TITLE: "SkySend",
    RATE_LIMIT_WINDOW: 60000,
    RATE_LIMIT_MAX: 5,
    UPLOAD_QUOTA_BYTES: 0,
    UPLOAD_QUOTA_WINDOW: 86400,
    MAX_FILES_PER_UPLOAD: 32,
    TRUST_PROXY: false,
    ...overrides,
  };
}

describe("rate limiter", () => {
  it("should allow requests under the limit", async () => {
    const config = makeConfig({ RATE_LIMIT_MAX: 5 });
    const app = new Hono();
    app.use("*", createRateLimiter(config));
    app.get("/test", (c) => c.json({ ok: true }));

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/test");
      expect(res.status).toBe(200);
    }
  });

  it("should block requests over the limit", async () => {
    const config = makeConfig({ RATE_LIMIT_MAX: 3 });
    const app = new Hono();
    app.use("*", createRateLimiter(config));
    app.get("/test", (c) => c.json({ ok: true }));

    for (let i = 0; i < 3; i++) {
      const res = await app.request("/test");
      expect(res.status).toBe(200);
    }

    const blocked = await app.request("/test");
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toBe("Too many requests");
  });

  it("should set rate limit headers", async () => {
    const config = makeConfig({ RATE_LIMIT_MAX: 10 });
    const app = new Hono();
    app.use("*", createRateLimiter(config));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("9");
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("should track different IPs separately", async () => {
    const config = makeConfig({ RATE_LIMIT_MAX: 2, TRUST_PROXY: true });
    const app = new Hono();
    app.use("*", createRateLimiter(config));
    app.get("/test", (c) => c.json({ ok: true }));

    // IP A: 2 requests
    for (let i = 0; i < 2; i++) {
      const res = await app.request("/test", {
        headers: { "X-Forwarded-For": "1.2.3.4" },
      });
      expect(res.status).toBe(200);
    }

    // IP A: blocked
    const blockedA = await app.request("/test", {
      headers: { "X-Forwarded-For": "1.2.3.4" },
    });
    expect(blockedA.status).toBe(429);

    // IP B: still allowed
    const resB = await app.request("/test", {
      headers: { "X-Forwarded-For": "5.6.7.8" },
    });
    expect(resB.status).toBe(200);
  });
});

describe("getClientIp", () => {
  function createApp(trustProxy: boolean) {
    const app = new Hono();
    app.get("/", (c) => {
      return c.text(getClientIp(c, trustProxy));
    });
    return app;
  }

  it("should extract IP from X-Forwarded-For when trusted", async () => {
    const app = createApp(true);
    const res = await app.request("/", {
      headers: { "X-Forwarded-For": "1.2.3.4, 10.0.0.1" },
    });
    expect(await res.text()).toBe("1.2.3.4");
  });

  it("should extract IP from X-Real-IP when trusted", async () => {
    const app = createApp(true);
    const res = await app.request("/", {
      headers: { "X-Real-IP": "5.6.7.8" },
    });
    expect(await res.text()).toBe("5.6.7.8");
  });

  it("should prefer X-Forwarded-For over X-Real-IP when trusted", async () => {
    const app = createApp(true);
    const res = await app.request("/", {
      headers: {
        "X-Forwarded-For": "1.2.3.4",
        "X-Real-IP": "5.6.7.8",
      },
    });
    expect(await res.text()).toBe("1.2.3.4");
  });

  it("should ignore proxy headers when not trusted", async () => {
    const app = createApp(false);
    const res = await app.request("/", {
      headers: { "X-Forwarded-For": "1.2.3.4" },
    });
    // Without a real Node.js socket, getConnInfo falls back to "unknown"
    expect(await res.text()).toBe("unknown");
  });

  it("should return 'unknown' when no headers present", async () => {
    const app = createApp(true);
    const res = await app.request("/");
    expect(await res.text()).toBe("unknown");
  });
});
