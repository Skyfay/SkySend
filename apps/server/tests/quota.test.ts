import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono, type Context } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUploadQuota, type QuotaReservation } from "../src/middleware/quota.js";
import type { Config } from "../src/lib/config.js";
import { initDatabase, closeDatabase } from "../src/db/index.js";

let tempDir: string;

/** The reservation the quota middleware put on the request. */
const reservationOf = (c: Context) => c.get("quotaReservation" as never) as QuotaReservation;

/** Records `bytes` of stored uploads for `ip`, the way a finished upload does. */
function seed(quota: ReturnType<typeof createUploadQuota>, ip: string, bytes: number): void {
  const decision = quota.reserve(ip, 0);
  if (!decision.ok || !decision.reservation) throw new Error("quota refused the seed");
  decision.reservation.commit(bytes);
}

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
      // Simulate recording 500 bytes
      reservationOf(c).commit(500);
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
      // Use up the entire quota
      reservationOf(c).commit(1024);
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
      reservationOf(c).commit(400);
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

  it("should return 413 when request content length would exceed remaining quota", async () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 });
    const quota = createUploadQuota(config);
    const app = new Hono();
    app.use("*", quota.middleware);
    app.post("/upload", (c) => {
      reservationOf(c).commit(900);
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

  it("reserve() lets every upload through without a reservation when quota is disabled", () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 0 });
    const quota = createUploadQuota(config);
    const result = quota.reserve("127.0.0.1", 100);
    expect(result).toEqual({ ok: true, reservation: null });
  });

  it("reserve() should return ok:false when quota is fully exhausted", () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 500 });
    const quota = createUploadQuota(config);

    // Seed usage up to the limit
    seed(quota, "10.0.0.1", 500);

    const result = quota.reserve("10.0.0.1", 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(429);
      expect(result.reason).toContain("exceeded");
    }
  });

  it("reserve() should return ok:false when file size exceeds remaining quota", () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 });
    const quota = createUploadQuota(config);

    // Use up 900 bytes
    seed(quota, "10.0.0.2", 900);

    // 200 bytes would push total to 1100, exceeding the 1000-byte quota
    const result = quota.reserve("10.0.0.2", 200);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
      expect(result.reason).toContain("remaining quota");
    }
  });

  it("reserve() should return a reservation when quota allows the upload", () => {
    const config = makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 });
    const quota = createUploadQuota(config);
    const result = quota.reserve("10.0.0.3", 100);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reservation).not.toBeNull();
  });

  // Regression: parallel uploads each passed the check against the same used
  // bytes, because usage was only recorded once an upload finished.
  it("reserve() holds the declared size, so parallel uploads cannot share the same headroom", () => {
    const quota = createUploadQuota(makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 }));
    const decisions = Array.from({ length: 5 }, () => quota.reserve("10.0.0.4", 400));
    expect(decisions.map((d) => d.ok)).toEqual([true, true, false, false, false]);
    expect(quota.reserve("10.0.0.4", 200).ok).toBe(true);
    const full = quota.reserve("10.0.0.4", 1);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.status).toBe(429);
    // Another IP has its own budget.
    expect(quota.reserve("10.0.0.5", 1000).ok).toBe(true);
  });

  it("release() gives the reserved bytes back", () => {
    const quota = createUploadQuota(makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 }));
    const first = quota.reserve("10.0.0.6", 800);
    expect(quota.reserve("10.0.0.6", 800).ok).toBe(false);
    if (first.ok) first.reservation?.release();
    expect(quota.reserve("10.0.0.6", 800).ok).toBe(true);
  });

  it("commit() records the stored bytes once and ends the reservation", () => {
    const quota = createUploadQuota(makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 }));
    const decision = quota.reserve("10.0.0.7", 600);
    if (!decision.ok || !decision.reservation) throw new Error("expected a reservation");
    decision.reservation.commit(600);
    decision.reservation.commit(600);
    decision.reservation.release();
    // 600 stored, nothing held: 400 fit, 401 do not.
    expect(quota.reserve("10.0.0.7", 401).ok).toBe(false);
    expect(quota.reserve("10.0.0.7", 400).ok).toBe(true);
  });

  it("release() after a commit keeps the recorded usage", () => {
    const quota = createUploadQuota(makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 }));
    const decision = quota.reserve("10.0.0.8", 0);
    if (!decision.ok || !decision.reservation) throw new Error("expected a reservation");
    decision.reservation.commit(1000);
    decision.reservation.release();
    expect(quota.reserve("10.0.0.8", 1).ok).toBe(false);
  });

  it("the middleware gives the reservation back when the upload it started fails", async () => {
    const quota = createUploadQuota(makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 }));
    const app = new Hono();
    app.use("*", quota.middleware);
    app.post("/refused", (c) => c.json({ error: "bad headers" }, 400));
    app.post("/broken", () => {
      throw new Error("storage failed");
    });
    // Like a chunked init: the session keeps the reservation until finalize.
    app.post("/started", (c) => c.json({ id: "session" }, 201));
    const post = (path: string, size: number) =>
      app.request(path, { method: "POST", headers: { "X-Content-Length": String(size) } });

    expect((await post("/refused", 900)).status).toBe(400);
    expect((await post("/broken", 900)).status).toBe(500);
    expect((await post("/started", 900)).status).toBe(201);
    // The started upload still holds its 900 bytes.
    expect((await post("/started", 200)).status).toBe(413);
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

  it("getStatus() counts the bytes running uploads hold", async () => {
    const quota = createUploadQuota(makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 }));
    const app = new Hono();
    app.post("/start", quota.middleware, (c) => c.json({ id: "session" }, 201));
    app.get("/status", (c) => c.json(quota.getStatus(c)));

    await app.request("/start", { method: "POST", headers: { "X-Content-Length": "300" } });
    const body = await (await app.request("/status")).json();
    expect(body.used).toBe(300);
    expect(body.remaining).toBe(700);
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
    seed(quota1, "192.168.1.1", 600);

    // Second instance with the same open DB: should restore the key and log
    const quota2 = createUploadQuota(config);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[quota] Restored"));

    // Because the HMAC key is the same, the same IP maps to the same hashedIp
    // and quota2 sees the 600 bytes recorded by quota1
    const r2 = quota2.reserve("192.168.1.1", 500); // 600 + 500 = 1100 > 1000
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
    seed(quota, "172.16.0.1", 900);
    expect(quota.reserve("172.16.0.1", 200).ok).toBe(false);

    // Advance 24 hours - the rotate interval fires and clears all usage
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    // After rotation, the IP hashes to a new value and has no usage - 900 bytes allowed again
    expect(quota.reserve("172.16.0.1", 900).ok).toBe(true);
  });

  it("should clean up expired usage entries via the periodic cleanup interval", async () => {
    const config = makeConfig({
      FILE_UPLOAD_QUOTA_BYTES: 1000,
      FILE_UPLOAD_QUOTA_WINDOW: 1, // 1-second window so entries expire quickly
    });
    const quota = createUploadQuota(config);

    // Record 900 bytes - entry resets at now + 1 second
    seed(quota, "172.16.0.2", 900);

    // Advance past the quota window (1 s) - cleanup interval fires, expired entries removed
    await vi.advanceTimersByTimeAsync(1001);

    // Entry is expired and cleaned up, so a new large upload is allowed
    expect(quota.reserve("172.16.0.2", 900).ok).toBe(true);
  });

  it("lets a reservation lapse when the quota window it was granted in ends", async () => {
    const quota = createUploadQuota(
      makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000, FILE_UPLOAD_QUOTA_WINDOW: 1 }),
    );
    // Never committed nor released, as if a transport lost track of it.
    expect(quota.reserve("172.16.0.3", 900).ok).toBe(true);
    expect(quota.reserve("172.16.0.3", 900).ok).toBe(false);

    await vi.advanceTimersByTimeAsync(1001);
    expect(quota.reserve("172.16.0.3", 900).ok).toBe(true);
  });

  it("forgets every reservation when the HMAC key rotates", async () => {
    const quota = createUploadQuota(makeConfig({ FILE_UPLOAD_QUOTA_BYTES: 1000 }));
    expect(quota.reserve("172.16.0.4", 900).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(quota.reserve("172.16.0.4", 900).ok).toBe(true);
  });
});
