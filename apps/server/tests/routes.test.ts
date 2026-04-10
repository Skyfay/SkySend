import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
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
import { passwordRoute } from "../src/routes/password.js";
import { createDeleteRoute } from "../src/routes/delete.js";
import { existsRoute } from "../src/routes/exists.js";
import { healthRoute } from "../src/routes/health.js";

const DEFAULT_CONFIG = {
  PORT: 3000,
  HOST: "0.0.0.0",
  BASE_URL: "http://localhost:3000",
  DATA_DIR: "./data",
  MAX_FILE_SIZE: 2 * 1024 ** 3,
  EXPIRE_OPTIONS_SEC: [300, 3600, 86400, 604800],
  DEFAULT_EXPIRE_SEC: 86400,
  DOWNLOAD_OPTIONS: [1, 2, 3, 4, 5, 10, 20, 50, 100],
  DEFAULT_DOWNLOAD: 1,
  CLEANUP_INTERVAL: 60,
  SITE_TITLE: "SkySend",
  RATE_LIMIT_WINDOW: 60000,
  RATE_LIMIT_MAX: 60,
  UPLOAD_QUOTA_BYTES: 0,
  UPLOAD_QUOTA_WINDOW: 86400,
  MAX_FILES_PER_UPLOAD: 32,
  TRUST_PROXY: false,
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
      expect(body.maxFileSize).toBe(DEFAULT_CONFIG.MAX_FILE_SIZE);
      expect(body.maxFilesPerUpload).toBe(32);
      expect(body.expireOptions).toEqual([300, 3600, 86400, 604800]);
      expect(body.downloadOptions).toEqual([1, 2, 3, 4, 5, 10, 20, 50, 100]);
      expect(body.siteTitle).toBe("SkySend");
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
      app.route("/api/password", passwordRoute);

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
      app.route("/api/password", passwordRoute);

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
      app.route("/api/password", passwordRoute);

      const res = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 404 for non-existent upload", async () => {
      const app = new Hono();
      app.route("/api/password", passwordRoute);

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
      app.route("/api/password", passwordRoute);

      const res = await app.request(`/api/password/${TEST_UUID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });

      expect(res.status).toBe(410);
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
    const validSalt = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");

    function makeUploadHeaders(overrides: Record<string, string> = {}) {
      return {
        "X-Auth-Token": fakeBase64urlToken(),
        "X-Owner-Token": fakeBase64urlToken(),
        "X-Salt": validSalt,
        "X-Max-Downloads": "1",
        "X-Expire-Sec": "86400",
        "X-File-Count": "1",
        "Content-Length": "5",
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

    it("should reject file exceeding MAX_FILE_SIZE", async () => {
      vi.mocked(getConfig).mockReturnValue({
        ...DEFAULT_CONFIG,
        MAX_FILE_SIZE: 3, // 3 bytes
      });

      const app = new Hono();
      app.route("/api/upload", createUploadRoute(storage));

      const res = await app.request("/api/upload", {
        method: "POST",
        headers: makeUploadHeaders({ "Content-Length": "5" }),
        body: new Uint8Array([1, 2, 3, 4, 5]),
      });

      expect(res.status).toBe(413);
    });

    it("should reject too many files per upload", async () => {
      vi.mocked(getConfig).mockReturnValue({
        ...DEFAULT_CONFIG,
        MAX_FILES_PER_UPLOAD: 5,
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
});
