import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUploadQuota } from "../src/middleware/quota.js";
import type { Config } from "../src/lib/config.js";
import { initDatabase, closeDatabase } from "../src/db/index.js";

let tempDir: string;

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    PORT: 3000,
    HOST: "0.0.0.0",
    BASE_URL: "http://localhost:3000",
    CORS_ORIGINS: [],
    DATA_DIR: "./data",
    UPLOADS_DIR: "./data/uploads",
    FILE_MAX_SIZE: 2 * 1024 ** 3,
    FILE_EXPIRE_OPTIONS_SEC: [300, 3600, 86400, 604800],
    FILE_DEFAULT_EXPIRE_SEC: 86400,
    FILE_DOWNLOAD_OPTIONS: [1, 2, 3, 4, 5, 10, 20, 50, 100],
    FILE_DEFAULT_DOWNLOAD: 1,
    FILE_MAX_FILES_PER_UPLOAD: 32,
    FILE_UPLOAD_QUOTA_BYTES: 1024, // 1 KB quota
    FILE_UPLOAD_QUOTA_WINDOW: 86400,
    NOTE_MAX_SIZE: 1024 ** 2,
    NOTE_EXPIRE_OPTIONS_SEC: [300, 3600, 86400, 604800],
    NOTE_DEFAULT_EXPIRE_SEC: 86400,
    NOTE_VIEW_OPTIONS: [1, 2, 3, 5, 10, 20, 50, 100],
    NOTE_DEFAULT_VIEWS: 1,
    CLEANUP_INTERVAL: 60,
    CUSTOM_TITLE: "SkySend",
    RATE_LIMIT_WINDOW: 60000,
    RATE_LIMIT_MAX: 60,
    TRUST_PROXY: false,
    ENABLED_SERVICES: ["file", "note"] as ("file" | "note")[],
    ...overrides,
  };
}

describe("upload quota", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "skysend-quota-test-"));
    initDatabase(tempDir);
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should be a no-op when quota is disabled", async () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 0 });
    const quota = createUploadQuota(config);
    const app = new Hono();
    app.use("*", quota.middleware);
    app.post("/upload", (c) => c.json({ ok: true }));

    const res = await app.request("/upload", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("should allow requests under quota", async () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1024 });
    const quota = createUploadQuota(config);
    const app = new Hono();
    app.use("*", quota.middleware);
    app.post("/upload", (c) => {
      const hashedIp = c.get("quotaHashedIp" as never) as string;
      // Simulate recording 500 bytes
      quota.recordUsage(hashedIp, 500);
      return c.json({ ok: true });
    });

    const res = await app.request("/upload", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("should block when quota is exhausted", async () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1024 });
    const quota = createUploadQuota(config);
    const app = new Hono();
    app.use("*", quota.middleware);
    app.post("/upload", (c) => {
      const hashedIp = c.get("quotaHashedIp" as never) as string;
      // Use up the entire quota
      quota.recordUsage(hashedIp, 1024);
      return c.json({ ok: true });
    });

    // First request uses up quota
    const res1 = await app.request("/upload", { method: "POST" });
    expect(res1.status).toBe(200);

    // Second request should be blocked
    const res2 = await app.request("/upload", { method: "POST" });
    expect(res2.status).toBe(429);
    const body = await res2.json();
    expect(body.error).toContain("quota");
  });

  it("should track usage incrementally", async () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 });
    const quota = createUploadQuota(config);
    const app = new Hono();
    app.use("*", quota.middleware);
    app.post("/upload", (c) => {
      const hashedIp = c.get("quotaHashedIp" as never) as string;
      quota.recordUsage(hashedIp, 400);
      return c.json({ ok: true });
    });

    // First request: 400/1000 used
    const res1 = await app.request("/upload", { method: "POST" });
    expect(res1.status).toBe(200);

    // Second request: 800/1000 used
    const res2 = await app.request("/upload", { method: "POST" });
    expect(res2.status).toBe(200);

    // Third request: 1200/1000 - should be blocked since 800 < 1000, but after recording it'll be 1200
    // Actually the check is pre-upload: bytesUsed >= quota, so 800 < 1000 passes
    const res3 = await app.request("/upload", { method: "POST" });
    expect(res3.status).toBe(200);

    // Fourth request: 1200 >= 1000 - blocked
    const res4 = await app.request("/upload", { method: "POST" });
    expect(res4.status).toBe(429);
  });

  it("should not record usage when quota is disabled", () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 0 });
    const quota = createUploadQuota(config);
    // Should not throw
    quota.recordUsage("some-hashed-ip", 99999);
  });

  it("should return 413 when request content length would exceed remaining quota", async () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 });
    const quota = createUploadQuota(config);
    const app = new Hono();
    app.use("*", quota.middleware);
    app.post("/upload", (c) => {
      const hashedIp = c.get("quotaHashedIp" as never) as string;
      quota.recordUsage(hashedIp, 900);
      return c.json({ ok: true });
    });

    // First request: records 900 bytes of the 1000-byte quota
    const res1 = await app.request("/upload", { method: "POST" });
    expect(res1.status).toBe(200);

    // Second request: declares 200 bytes which would push total to 1100 > 1000
    const res2 = await app.request("/upload", {
      method: "POST",
      headers: { "X-Content-Length": "200" },
    });
    expect(res2.status).toBe(413);
    const body = await res2.json();
    expect(body.error).toContain("remaining quota");
  });

  it("check() should return ok:true with null hashedIp when quota is disabled", () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 0 });
    const quota = createUploadQuota(config);
    const result = quota.check("127.0.0.1", 100);
    expect(result).toEqual({ ok: true, hashedIp: null });
  });

  it("check() should return ok:false when quota is fully exhausted", () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 500 });
    const quota = createUploadQuota(config);

    // Seed usage up to the limit
    const init = quota.check("10.0.0.1", 0);
    expect(init.ok).toBe(true);
    if (init.ok && init.hashedIp) {
      quota.recordUsage(init.hashedIp, 500);
    }

    const result = quota.check("10.0.0.1", 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("exceeded");
    }
  });

  it("check() should return ok:false when file size exceeds remaining quota", () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 });
    const quota = createUploadQuota(config);

    // Use up 900 bytes
    const init = quota.check("10.0.0.2", 0);
    expect(init.ok).toBe(true);
    if (init.ok && init.hashedIp) {
      quota.recordUsage(init.hashedIp, 900);
    }

    // 200 bytes would push total to 1100, exceeding the 1000-byte quota
    const result = quota.check("10.0.0.2", 200);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("remaining quota");
    }
  });

  it("check() should return ok:true with hashedIp when quota allows the upload", () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 });
    const quota = createUploadQuota(config);
    const result = quota.check("10.0.0.3", 100);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.hashedIp).toBe("string");
      expect(result.hashedIp).toBeTruthy();
    }
  });

  it("getStatus() should return enabled status with usage info", async () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 });
    const quota = createUploadQuota(config);
    const app = new Hono();
    app.get("/status", (c) => c.json(quota.getStatus(c)));

    const res = await app.request("/status");
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.limit).toBe(1000);
    expect(body.used).toBe(0);
    expect(body.remaining).toBe(1000);
    expect(typeof body.resetsAt).toBe("string");
    expect(body.window).toBe(86400);
  });

  it("getStatus() should return disabled status when quota is off", async () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 0 });
    const quota = createUploadQuota(config);
    const app = new Hono();
    app.get("/status", (c) => c.json(quota.getStatus(c)));

    const res = await app.request("/status");
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.resetsAt).toBeNull();
  });

  it("should restore HMAC key and usage entries from database on re-init", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 });
    // First instance: fresh key, persisted to DB
    const quota1 = createUploadQuota(config);
    const r1 = quota1.check("192.168.1.1", 0);
    expect(r1.ok).toBe(true);
    if (r1.ok && r1.hashedIp) {
      quota1.recordUsage(r1.hashedIp, 600);
    }

    // Second instance with the same open DB: should restore the key and log
    const quota2 = createUploadQuota(config);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[quota] Restored"));

    // Because the HMAC key is the same, the same IP maps to the same hashedIp
    // and quota2 sees the 600 bytes recorded by quota1
    const r2 = quota2.check("192.168.1.1", 500); // 600 + 500 = 1100 > 1000
    expect(r2.ok).toBe(false);

    consoleSpy.mockRestore();
  });
});

describe("upload quota - interval behavior", () => {
  let localDir: string;

  beforeEach(() => {
    localDir = mkdtempSync(join(tmpdir(), "skysend-quota-timer-"));
    initDatabase(localDir);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    closeDatabase();
    rmSync(localDir, { recursive: true, force: true });
  });

  it("should rotate HMAC key and clear all usage entries after 24 hours", async () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 });
    const quota = createUploadQuota(config);

    // Record 900 bytes so a 200-byte upload is rejected
    const init = quota.check("172.16.0.1", 0);
    expect(init.ok).toBe(true);
    if (init.ok && init.hashedIp) {
      quota.recordUsage(init.hashedIp, 900);
    }
    expect(quota.check("172.16.0.1", 200).ok).toBe(false);

    // Advance 24 hours - the rotate interval fires and clears all usage
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    // After rotation, the IP hashes to a new value and has no usage - 900 bytes allowed again
    expect(quota.check("172.16.0.1", 900).ok).toBe(true);
  });

  it("should clean up expired usage entries via the periodic cleanup interval", async () => {
    const config = makeConfig({
      FILE_UPLOAD_QUOTA_BYTES: 1000,
      FILE_UPLOAD_QUOTA_WINDOW: 1, // 1-second window so entries expire quickly
    });
    const quota = createUploadQuota(config);

    // Record 900 bytes - entry resets at now + 1 second
    const init = quota.check("172.16.0.2", 0);
    expect(init.ok).toBe(true);
    if (init.ok && init.hashedIp) {
      quota.recordUsage(init.hashedIp, 900);
    }

    // Advance past the quota window (1 s) - cleanup interval fires, expired entries removed
    await vi.advanceTimersByTimeAsync(1001);

    // Entry is expired and cleaned up, so a new large upload is allowed
    expect(quota.check("172.16.0.2", 900).ok).toBe(true);
  });
});
