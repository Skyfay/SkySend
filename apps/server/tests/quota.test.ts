import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
