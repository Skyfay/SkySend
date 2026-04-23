import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { createTestDb, createTestStorage, insertTestUpload, TEST_UUID, fakeBase64urlToken } from "./helpers.js";
import { uploads } from "../src/db/schema.js";
import type { FileStorage } from "../src/storage/filesystem.js";

// Mock both db and config modules
vi.mock("../src/db/index.js", () => ({
  getDb: vi.fn(),
  initDatabase: vi.fn(),
}));

vi.mock("../src/lib/config.js", () => ({
  getConfig: vi.fn(),
  loadConfig: vi.fn(),
}));

import { getDb } from "../src/db/index.js";
import { getConfig } from "../src/lib/config.js";
import { configRoute } from "../src/routes/config.js";
import { createUploadRoute } from "../src/routes/upload.js";
import { metaRoute } from "../src/routes/meta.js";
import { infoRoute } from "../src/routes/info.js";
import { createDownloadRoute } from "../src/routes/download.js";
import { createPasswordRoute } from "../src/routes/password.js";
import { createDeleteRoute } from "../src/routes/delete.js";
import { existsRoute } from "../src/routes/exists.js";
import { healthRoute } from "../src/routes/health.js";
import { createNoteRoute } from "../src/routes/note.js";
import { createPasswordLockout } from "../src/lib/password-lockout.js";

const mockLockout = createPasswordLockout(10, 60_000);

const DEFAULT_CONFIG = {
  PORT: 3000,
  HOST: "0.0.0.0",
  BASE_URL: "http://localhost:3000",
  DATA_DIR: "./data",
  FILE_MAX_SIZE: 2 * 1024 ** 3,
  FILE_EXPIRE_OPTIONS_SEC: [300, 3600, 86400, 604800],
  FILE_DEFAULT_EXPIRE_SEC: 86400,
  FILE_DOWNLOAD_OPTIONS: [1, 2, 3, 4, 5, 10, 20, 50, 100],
  FILE_DEFAULT_DOWNLOAD: 1,
  FILE_MAX_FILES_PER_UPLOAD: 32,
  FILE_UPLOAD_QUOTA_BYTES: 0,
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
};

describe("routes", () => {
  let dbCtx: ReturnType<typeof createTestDb>;
  let storageCtx: Awaited<ReturnType<typeof createTestStorage>>;
  let storage: FileStorage;

  beforeEach(async () => {
    dbCtx = createTestDb();
    storageCtx = await createTestStorage();
    storage = storageCtx.storage;
    vi.mocked(getDb).mockReturnValue(dbCtx.db);
    vi.mocked(getConfig).mockReturnValue(DEFAULT_CONFIG);
  });

  afterEach(() => {
    dbCtx.cleanup();
    storageCtx.cleanup();
    vi.restoreAllMocks();
  });

  // ── Health ──────────────────────────────────────────

  describe("GET /api/health", () => {
    it("should return ok status", async () => {
      const app = new Hono();
      app.route("/api/health", healthRoute);

      const res = await app.request("/api/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeTruthy();
    });
  });

  // ── Config ──────────────────────────────────────────

  describe("GET /api/config", () => {
    it("should return server configuration", async () => {
      const app = new Hono();
      app.route("/api/config", configRoute);

      const res = await app.request("/api/config");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.fileMaxSize).toBe(DEFAULT_CONFIG.FILE_MAX_SIZE);
      expect(body.fileMaxFilesPerUpload).toBe(32);
      expect(body.fileExpireOptions).toEqual([300, 3600, 86400, 604800]);
      expect(body.fileDownloadOptions).toEqual([1, 2, 3, 4, 5, 10, 20, 50, 100]);
      expect(body.customTitle).toBe("SkySend");
      expect(body.noteMaxSize).toBe(1024 ** 2);
      expect(body.noteViewOptions).toEqual([1, 2, 3, 5, 10, 20, 50, 100]);
    });
  });

  // ── Exists ──────────────────────────────────────────

  describe("GET /api/exists/:id", () => {
    it("should return false for non-existent upload", async () => {
      const app = new Hono();
      app.route("/api/exists", existsRoute);

      const res = await app.request(`/api/exists/${TEST_UUID}`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.exists).toBe(false);
    });

    it("should return true for active upload", async () => {
      insertTestUpload(dbCtx.db);
      const app = new Hono();
      app.route("/api/exists", existsRoute);

      const res = await app.request(`/api/exists/${TEST_UUID}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.exists).toBe(true);
    });

    it("should return 410 for expired upload", async () => {
      insertTestUpload(dbCtx.db, {
        expiresAt: new Date(Date.now() - 1000),
      });
      const app = new Hono();
      app.route("/api/exists", existsRoute);

      const res = await app.request(`/api/exists/${TEST_UUID}`);
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.exists).toBe(false);
      expect(body.reason).toBe("expired");
    });

    it("should return 410 for download-limited upload", async () => {
      insertTestUpload(dbCtx.db, {
        maxDownloads: 3,
        downloadCount: 3,
      });
      const app = new Hono();
      app.route("/api/exists", existsRoute);

      const res = await app.request(`/api/exists/${TEST_UUID}`);
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.reason).toBe("limit_reached");
    });
  });

  // ── Info ────────────────────────────────────────────

  describe("GET /api/info/:id", () => {
    it("should return upload info", async () => {
      const authToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, { authToken });

      const app = new Hono();
      app.route("/api/info", infoRoute);

      const res = await app.request(`/api/info/${TEST_UUID}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(TEST_UUID);
      expect(body.size).toBe(1024);
      expect(body.fileCount).toBe(1);
      expect(body.hasPassword).toBe(false);
      expect(body.downloadCount).toBe(0);
      expect(body.maxDownloads).toBe(10);
      expect(body.salt).toBeTruthy();
      expect(body.expiresAt).toBeTruthy();
      expect(body.createdAt).toBeTruthy();
    });

    it("should return 404 for non-existent upload", async () => {
      const app = new Hono();
      app.route("/api/info", infoRoute);

      const res = await app.request(`/api/info/${TEST_UUID}`);
      expect(res.status).toBe(404);
    });

    it("should return 410 for expired upload", async () => {
      insertTestUpload(dbCtx.db, {
        expiresAt: new Date(Date.now() - 1000),
      });
      const app = new Hono();
      app.route("/api/info", infoRoute);

      const res = await app.request(`/api/info/${TEST_UUID}`);
      expect(res.status).toBe(410);
    });

    it("should not expose tokens or storage path", async () => {
      insertTestUpload(dbCtx.db);
      const app = new Hono();
      app.route("/api/info", infoRoute);

      const res = await app.request(`/api/info/${TEST_UUID}`);
      const body = await res.json();
      expect(body.ownerToken).toBeUndefined();
      expect(body.authToken).toBeUndefined();
      expect(body.storagePath).toBeUndefined();
    });
  });

  // ── Meta ────────────────────────────────────────────

  describe("POST /api/meta/:id", () => {
    it("should save metadata with valid owner token", async () => {
      const ownerToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, { ownerToken });

      const app = new Hono();
      app.route("/api/meta", metaRoute);

      const res = await app.request(`/api/meta/${TEST_UUID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Token": ownerToken,
        },
        body: JSON.stringify({
          encryptedMeta: Buffer.from("test-meta").toString("base64"),
          nonce: Buffer.from("test-nonce").toString("base64"),
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify metadata was stored
      const upload = await dbCtx.db.query.uploads.findFirst({
        where: eq(uploads.id, TEST_UUID),
      });
      expect(upload!.encryptedMeta).toBeTruthy();
      expect(upload!.nonce).toBeTruthy();
    });

    it("should reject without owner token", async () => {
      insertTestUpload(dbCtx.db);

      const app = new Hono();
      app.route("/api/meta", metaRoute);

      const res = await app.request(`/api/meta/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedMeta: "dGVzdA",
          nonce: "dGVzdA",
        }),
      });

      expect(res.status).toBe(401);
    });

    it("should reject with wrong owner token", async () => {
      insertTestUpload(dbCtx.db);

      const app = new Hono();
      app.route("/api/meta", metaRoute);

      const res = await app.request(`/api/meta/${TEST_UUID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Token": fakeBase64urlToken(),
        },
        body: JSON.stringify({
          encryptedMeta: "dGVzdA",
          nonce: "dGVzdA",
        }),
      });

      expect(res.status).toBe(401);
    });

    it("should reject overwriting existing metadata", async () => {
      const ownerToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, { ownerToken });

      // First set metadata
      dbCtx.db
        .update(uploads)
        .set({
          encryptedMeta: Buffer.from("existing"),
          nonce: Buffer.from("existing-nonce"),
        })
        .where(eq(uploads.id, TEST_UUID))
        .run();

      const app = new Hono();
      app.route("/api/meta", metaRoute);

      const res = await app.request(`/api/meta/${TEST_UUID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Token": ownerToken,
        },
        body: JSON.stringify({
          encryptedMeta: "bmV3LW1ldGE",
          nonce: "bmV3LW5vbmNl",
        }),
      });

      expect(res.status).toBe(409);
    });

    it("should return 400 for invalid JSON body", async () => {
      const ownerToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, { ownerToken });

      const app = new Hono();
      app.route("/api/meta", metaRoute);

      const res = await app.request(`/api/meta/${TEST_UUID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Token": ownerToken,
        },
        body: "not valid json",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid JSON");
    });

    it("should return 400 when required fields are missing", async () => {
      const ownerToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, { ownerToken });

      const app = new Hono();
      app.route("/api/meta", metaRoute);

      const res = await app.request(`/api/meta/${TEST_UUID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Token": ownerToken,
        },
        body: JSON.stringify({ encryptedMeta: "dGVzdA" }), // missing nonce
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid request body");
    });

    it("should return 400 when encryptedMeta decodes to empty bytes", async () => {
      const ownerToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, { ownerToken });

      const app = new Hono();
      app.route("/api/meta", metaRoute);

      // A single base64 character decodes to 0 bytes (incomplete group)
      const res = await app.request(`/api/meta/${TEST_UUID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Token": ownerToken,
        },
        body: JSON.stringify({
          encryptedMeta: "a",
          nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64"),
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("encryptedMeta");
    });

    it("should return 400 when nonce decodes to empty bytes", async () => {
      const ownerToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, { ownerToken });

      const app = new Hono();
      app.route("/api/meta", metaRoute);

      // A single base64 character decodes to 0 bytes (incomplete group)
      const res = await app.request(`/api/meta/${TEST_UUID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Token": ownerToken,
        },
        body: JSON.stringify({
          encryptedMeta: Buffer.from("test-meta").toString("base64"),
          nonce: "a",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("nonce");
    });
  });

  // ── Password ────────────────────────────────────────

  describe("POST /api/password/:id", () => {
    it("should verify correct auth token for password-protected upload", async () => {
      const authToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, {
        authToken,
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "argon2id",
      });

      const app = new Hono();
      app.route("/api/password", createPasswordRoute(mockLockout));

      const res = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("should reject wrong auth token", async () => {
      insertTestUpload(dbCtx.db, {
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "argon2id",
      });

      const app = new Hono();
      app.route("/api/password", createPasswordRoute(mockLockout));

      const res = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });

      expect(res.status).toBe(401);
    });

    it("should reject for non-password-protected upload", async () => {
      insertTestUpload(dbCtx.db, { hasPassword: false });

      const app = new Hono();
      app.route("/api/password", createPasswordRoute(mockLockout));

      const res = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 404 for non-existent upload", async () => {
      const app = new Hono();
      app.route("/api/password", createPasswordRoute(mockLockout));

      const res = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });

      expect(res.status).toBe(404);
    });

    it("should reject for expired upload", async () => {
      insertTestUpload(dbCtx.db, {
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "argon2id",
        expiresAt: new Date(Date.now() - 1000),
      });

      const app = new Hono();
      app.route("/api/password", createPasswordRoute(mockLockout));

      const res = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });

      expect(res.status).toBe(410);
    });

    it("should return 400 when request body is not valid JSON", async () => {
      insertTestUpload(dbCtx.db, {
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "argon2id",
      });

      const app = new Hono();
      app.route("/api/password", createPasswordRoute(mockLockout));

      const res = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-valid-json",
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 when authToken is missing from body", async () => {
      insertTestUpload(dbCtx.db, {
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "argon2id",
      });

      const app = new Hono();
      app.route("/api/password", createPasswordRoute(mockLockout));

      const res = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("authToken");
    });

    it("should return 400 when authToken is not a string", async () => {
      insertTestUpload(dbCtx.db, {
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "argon2id",
      });

      const app = new Hono();
      app.route("/api/password", createPasswordRoute(mockLockout));

      const res = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: 12345 }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 401 when authToken is not valid base64url", async () => {
      insertTestUpload(dbCtx.db, {
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "argon2id",
      });

      const app = new Hono();
      app.route("/api/password", createPasswordRoute(mockLockout));

      const res = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: "!!!not-valid-base64url!!!" }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Invalid auth token format");
    });

    it("should lock IP after repeated failed attempts and return 429 with Retry-After header", async () => {
      const authToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, {
        authToken,
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "argon2id",
      });

      // Use a fresh lockout with low attempt limit to keep the test fast
      const strictLockout = createPasswordLockout(3, 60_000);
      const app = new Hono();
      app.route("/api/password", createPasswordRoute(strictLockout));

      // Send 3 requests with wrong tokens to trigger lockout
      for (let i = 0; i < 3; i++) {
        const res = await app.request(`/api/password/${TEST_UUID}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authToken: fakeBase64urlToken() }),
        });
        expect(res.status).toBe(401);
      }

      // 4th attempt should be locked out
      const lockedRes = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken }),
      });

      expect(lockedRes.status).toBe(429);
      expect(lockedRes.headers.get("Retry-After")).toBeTruthy();
    });
  });

  // ── Delete ──────────────────────────────────────────

  describe("DELETE /api/upload/:id", () => {
    it("should delete upload with valid owner token", async () => {
      const ownerToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, { ownerToken });

      // Create file on disk
      const stream = new ReadableStream({
        start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); },
      });
      await storage.save(TEST_UUID, stream);

      const app = new Hono();
      app.route("/api/upload", createDeleteRoute(storage));

      const res = await app.request(`/api/upload/${TEST_UUID}`, {
        method: "DELETE",
        headers: { "X-Owner-Token": ownerToken },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify DB record removed
      const upload = await dbCtx.db.query.uploads.findFirst({
        where: eq(uploads.id, TEST_UUID),
      });
      expect(upload).toBeUndefined();

      // Verify file removed
      expect(await storage.exists(TEST_UUID)).toBe(false);
    });

    it("should reject without owner token", async () => {
      insertTestUpload(dbCtx.db);

      const app = new Hono();
      app.route("/api/upload", createDeleteRoute(storage));

      const res = await app.request(`/api/upload/${TEST_UUID}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(401);
    });

    it("should reject with wrong owner token", async () => {
      insertTestUpload(dbCtx.db);

      const app = new Hono();
      app.route("/api/upload", createDeleteRoute(storage));

      const res = await app.request(`/api/upload/${TEST_UUID}`, {
        method: "DELETE",
        headers: { "X-Owner-Token": fakeBase64urlToken() },
      });

      expect(res.status).toBe(401);
    });
  });

  // ── Download ────────────────────────────────────────

  describe("GET /api/download/:id", () => {
    it("should stream file with valid auth token", async () => {
      const authToken = fakeBase64urlToken();
      const fileData = new Uint8Array([10, 20, 30, 40, 50]);
      insertTestUpload(dbCtx.db, {
        authToken,
        size: fileData.length,
      });

      await storage.save(TEST_UUID, new ReadableStream({
        start(c) { c.enqueue(fileData); c.close(); },
      }));

      const app = new Hono();
      app.route("/api/download", createDownloadRoute(storage));

      const res = await app.request(`/api/download/${TEST_UUID}`, {
        headers: { "X-Auth-Token": authToken },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-store");

      const body = new Uint8Array(await res.arrayBuffer());
      expect(body).toEqual(fileData);

      // Download count should be incremented
      const upload = await dbCtx.db.query.uploads.findFirst({
        where: eq(uploads.id, TEST_UUID),
      });
      expect(upload!.downloadCount).toBe(1);
    });

    it("should reject without auth token", async () => {
      insertTestUpload(dbCtx.db);

      const app = new Hono();
      app.route("/api/download", createDownloadRoute(storage));

      const res = await app.request(`/api/download/${TEST_UUID}`);
      expect(res.status).toBe(401);
    });

    it("should reject expired upload", async () => {
      const authToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, {
        authToken,
        expiresAt: new Date(Date.now() - 1000),
      });

      const app = new Hono();
      app.route("/api/download", createDownloadRoute(storage));

      const res = await app.request(`/api/download/${TEST_UUID}`, {
        headers: { "X-Auth-Token": authToken },
      });

      expect(res.status).toBe(410);
    });

    it("should reject when download limit reached", async () => {
      const authToken = fakeBase64urlToken();
      insertTestUpload(dbCtx.db, {
        authToken,
        maxDownloads: 5,
        downloadCount: 5,
      });

      const app = new Hono();
      app.route("/api/download", createDownloadRoute(storage));

      const res = await app.request(`/api/download/${TEST_UUID}`, {
        headers: { "X-Auth-Token": authToken },
      });

      expect(res.status).toBe(410);
    });
  });

  // ── Upload ──────────────────────────────────────────

  describe("POST /api/upload", () => {
    // SALT_LENGTH = 32 bytes (crypto package requirement for HKDF salt)
    const validSalt = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

    function makeUploadHeaders(overrides: Record<string, string> = {}) {
      return {
        "X-Auth-Token": fakeBase64urlToken(),
        "X-Owner-Token": fakeBase64urlToken(),
        "X-Salt": validSalt,
        "X-Max-Downloads": "1",
        "X-Expire-Sec": "86400",
        "X-File-Count": "1",
        "X-Content-Length": "5",
        ...overrides,
      };
    }

    it("should upload a file successfully", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const body = new Uint8Array([1, 2, 3, 4, 5]);
      const res = await app.request("/api/upload", {
        method: "POST",
        headers: makeUploadHeaders(),
        body,
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBeTruthy();
      expect(json.url).toContain(json.id);

      // Verify DB record
      const upload = await dbCtx.db.query.uploads.findFirst({
        where: eq(uploads.id, json.id),
      });
      expect(upload).toBeDefined();
      expect(upload!.size).toBe(5);
    });

    it("should reject missing auth token header", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const headers = makeUploadHeaders();
      delete (headers as Record<string, string>)["X-Auth-Token"];

      const res = await app.request("/api/upload", {
        method: "POST",
        headers,
        body: new Uint8Array([1]),
      });

      expect(res.status).toBe(400);
    });

    it("should reject invalid expiry time", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const res = await app.request("/api/upload", {
        method: "POST",
        headers: makeUploadHeaders({ "X-Expire-Sec": "999" }),
        body: new Uint8Array([1, 2, 3, 4, 5]),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("expiry");
    });

    it("should reject invalid download limit", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const res = await app.request("/api/upload", {
        method: "POST",
        headers: makeUploadHeaders({ "X-Max-Downloads": "999" }),
        body: new Uint8Array([1, 2, 3, 4, 5]),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("download limit");
    });

    it("should reject file exceeding FILE_MAX_SIZE", async () => {
      vi.mocked(getConfig).mockReturnValue({
        ...DEFAULT_CONFIG,
        FILE_MAX_SIZE: 3, // 3 bytes
      });

      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const res = await app.request("/api/upload", {
        method: "POST",
        headers: makeUploadHeaders({ "X-Content-Length": "5" }),
        body: new Uint8Array([1, 2, 3, 4, 5]),
      });

      expect(res.status).toBe(413);
    });

    it("should reject too many files per upload", async () => {
      vi.mocked(getConfig).mockReturnValue({
        ...DEFAULT_CONFIG,
        FILE_MAX_FILES_PER_UPLOAD: 5,
      });

      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const res = await app.request("/api/upload", {
        method: "POST",
        headers: makeUploadHeaders({ "X-File-Count": "10" }),
        body: new Uint8Array([1, 2, 3, 4, 5]),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("files per upload");
    });

    it("should reject password upload without required headers", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const res = await app.request("/api/upload", {
        method: "POST",
        headers: makeUploadHeaders({ "X-Has-Password": "true" }),
        body: new Uint8Array([1, 2, 3, 4, 5]),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Password-protected");
    });
  });

  // ── Chunked Upload (init / chunk / finalize) ────────

  describe("POST /api/upload/init, /chunk, /finalize", () => {
    const validChunkSalt = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

    function makeInitHeaders(overrides: Record<string, string> = {}) {
      return {
        "X-Auth-Token": fakeBase64urlToken(),
        "X-Owner-Token": fakeBase64urlToken(),
        "X-Salt": validChunkSalt,
        "X-Max-Downloads": "1",
        "X-Expire-Sec": "86400",
        "X-File-Count": "1",
        "X-Content-Length": "10",
        ...overrides,
      };
    }

    it("should return 400 for missing required headers on /init", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const headers = makeInitHeaders();
      delete (headers as Record<string, string>)["X-Auth-Token"];

      const res = await app.request("/api/upload/init", {
        method: "POST",
        headers,
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid request headers");
    });

    it("should return 400 for invalid expiry on /init", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const res = await app.request("/api/upload/init", {
        method: "POST",
        headers: makeInitHeaders({ "X-Expire-Sec": "999" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("expiry");
    });

    it("should return 404 for chunk with unknown session", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const res = await app.request("/api/upload/unknown-session-id/chunk?index=0", {
        method: "POST",
        body: new Uint8Array([1, 2, 3]),
      });

      expect(res.status).toBe(404);
    });

    it("should return 400 for chunk with missing index query param", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const initRes = await app.request("/api/upload/init", {
        method: "POST",
        headers: makeInitHeaders({ "X-Content-Length": "5" }),
      });
      expect(initRes.status).toBe(201);
      const { id } = await initRes.json();

      const res = await app.request(`/api/upload/${id}/chunk`, {
        method: "POST",
        body: new Uint8Array([1, 2, 3, 4, 5]),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("chunk index");
    });

    it("should return 400 for chunk with non-numeric index", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const initRes = await app.request("/api/upload/init", {
        method: "POST",
        headers: makeInitHeaders({ "X-Content-Length": "5" }),
      });
      expect(initRes.status).toBe(201);
      const { id } = await initRes.json();

      const res = await app.request(`/api/upload/${id}/chunk?index=abc`, {
        method: "POST",
        body: new Uint8Array([1, 2, 3, 4, 5]),
      });

      expect(res.status).toBe(400);
    });

    it("should complete a chunked upload with in-order chunks", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const chunk1 = new Uint8Array([1, 2, 3, 4, 5]);
      const chunk2 = new Uint8Array([6, 7, 8, 9, 10]);
      const totalSize = chunk1.length + chunk2.length;

      // Init
      const initRes = await app.request("/api/upload/init", {
        method: "POST",
        headers: makeInitHeaders({ "X-Content-Length": String(totalSize) }),
      });
      expect(initRes.status).toBe(201);
      const { id } = await initRes.json();
      expect(id).toBeTruthy();

      // Chunk 0
      const chunkRes1 = await app.request(`/api/upload/${id}/chunk?index=0`, {
        method: "POST",
        body: chunk1,
      });
      expect(chunkRes1.status).toBe(200);
      expect((await chunkRes1.json()).bytesWritten).toBe(chunk1.length);

      // Chunk 1
      const chunkRes2 = await app.request(`/api/upload/${id}/chunk?index=1`, {
        method: "POST",
        body: chunk2,
      });
      expect(chunkRes2.status).toBe(200);
      expect((await chunkRes2.json()).bytesWritten).toBe(totalSize);

      // Finalize
      const finalizeRes = await app.request(`/api/upload/${id}/finalize`, {
        method: "POST",
      });
      expect(finalizeRes.status).toBe(200);
      expect((await finalizeRes.json()).id).toBe(id);

      // Verify DB record was created
      const upload = await dbCtx.db.query.uploads.findFirst({
        where: eq(uploads.id, id),
      });
      expect(upload).toBeDefined();
      expect(upload!.size).toBe(totalSize);

      // Verify file exists on disk
      expect(await storage.exists(id)).toBe(true);
    });

    it("should buffer out-of-order chunks and flush them in correct sequence", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const chunk1 = new Uint8Array([1, 2, 3, 4, 5]);
      const chunk2 = new Uint8Array([6, 7, 8, 9, 10]);
      const totalSize = chunk1.length + chunk2.length;

      const initRes = await app.request("/api/upload/init", {
        method: "POST",
        headers: makeInitHeaders({ "X-Content-Length": String(totalSize) }),
      });
      expect(initRes.status).toBe(201);
      const { id } = await initRes.json();

      // Send chunk 1 FIRST (out of order) - should be buffered, bytesWritten stays 0
      const chunkRes2 = await app.request(`/api/upload/${id}/chunk?index=1`, {
        method: "POST",
        body: chunk2,
      });
      expect(chunkRes2.status).toBe(200);
      expect((await chunkRes2.json()).bytesWritten).toBe(0);

      // Send chunk 0 - triggers flush of both buffered chunks
      const chunkRes1 = await app.request(`/api/upload/${id}/chunk?index=0`, {
        method: "POST",
        body: chunk1,
      });
      expect(chunkRes1.status).toBe(200);
      expect((await chunkRes1.json()).bytesWritten).toBe(totalSize);

      // Finalize should succeed
      const finalizeRes = await app.request(`/api/upload/${id}/finalize`, {
        method: "POST",
      });
      expect(finalizeRes.status).toBe(200);
    });

    it("should return 400 on finalize when bytes written differ from declared size", async () => {
      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      // Declare 10 bytes but only upload 5
      const initRes = await app.request("/api/upload/init", {
        method: "POST",
        headers: makeInitHeaders({ "X-Content-Length": "10" }),
      });
      expect(initRes.status).toBe(201);
      const { id } = await initRes.json();

      await app.request(`/api/upload/${id}/chunk?index=0`, {
        method: "POST",
        body: new Uint8Array([1, 2, 3, 4, 5]),
      });

      const finalizeRes = await app.request(`/api/upload/${id}/finalize`, {
        method: "POST",
      });

      expect(finalizeRes.status).toBe(400);
      const json = await finalizeRes.json();
      expect(json.error).toContain("content length");
    });
  });

  // ── Service Guards ──────────────────────────────────

  describe("ENABLED_SERVICES guards", () => {
    function createGuardedApp() {
      const app = new Hono();
      // Replicate the service guard middleware from index.ts
      const fileGuard = async (c: Context, next: Next) => {
        const config = getConfig();
        if (!config.ENABLED_SERVICES.includes("file")) {
          return c.json({ error: "File service is disabled" }, 403);
        }
        return next();
      };
      app.use("/api/upload/*", fileGuard);
      app.use("/api/info/*", fileGuard);
      app.use("/api/download/*", fileGuard);

      const noteGuard = async (c: Context, next: Next) => {
        const config = getConfig();
        if (!config.ENABLED_SERVICES.includes("note")) {
          return c.json({ error: "Note service is disabled" }, 403);
        }
        return next();
      };
      app.use("/api/note/*", noteGuard);

      app.route("/api/upload", createUploadRoute(storage));
      app.route("/api/info", infoRoute);
      app.route("/api/download", createDownloadRoute(storage));
      app.route("/api/note", createNoteRoute(mockLockout));
      return app;
    }

    it("should return 403 for file upload when file service is disabled", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, ENABLED_SERVICES: ["note"] });
      const app = createGuardedApp();
      const res = await app.request("/api/upload/init", { method: "POST" });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("File service is disabled");
    });

    it("should return 403 for file info when file service is disabled", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, ENABLED_SERVICES: ["note"] });
      const app = createGuardedApp();
      const res = await app.request(`/api/info/${TEST_UUID}`);
      expect(res.status).toBe(403);
    });

    it("should return 403 for file download when file service is disabled", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, ENABLED_SERVICES: ["note"] });
      const app = createGuardedApp();
      const res = await app.request(`/api/download/${TEST_UUID}`, {
        headers: { "X-Auth-Token": fakeBase64urlToken() },
      });
      expect(res.status).toBe(403);
    });

    it("should return 403 for note creation when note service is disabled", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, ENABLED_SERVICES: ["file"] });
      const app = createGuardedApp();
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: "text" }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Note service is disabled");
    });

    it("should return 403 for note info when note service is disabled", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, ENABLED_SERVICES: ["file"] });
      const app = createGuardedApp();
      const res = await app.request(`/api/note/${TEST_UUID}`);
      expect(res.status).toBe(403);
    });

    it("should allow file routes when file service is enabled", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, ENABLED_SERVICES: ["file"] });
      const app = createGuardedApp();
      // Info for non-existent upload returns 404, not 403
      const res = await app.request(`/api/info/${TEST_UUID}`);
      expect(res.status).toBe(404);
    });

    it("should allow note routes when note service is enabled", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, ENABLED_SERVICES: ["note"] });
      const app = createGuardedApp();
      // Info for non-existent note returns 404, not 403
      const res = await app.request(`/api/note/${TEST_UUID}`);
      expect(res.status).toBe(404);
    });
  });
});
