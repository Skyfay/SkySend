import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createTestDb, insertTestNote, TEST_UUID, fakeBase64urlToken } from "./helpers.js";
import { notes } from "../src/db/schema.js";

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
import { createNoteRoute } from "../src/routes/note.js";
import { createPasswordLockout } from "../src/lib/password-lockout.js";

const mockLockout = createPasswordLockout(10, 60_000);

const DEFAULT_CONFIG = {
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
  FILE_UPLOAD_QUOTA_BYTES: 0,
  FILE_UPLOAD_QUOTA_WINDOW: 86400,
  NOTE_MAX_SIZE: 1024 ** 2,
  NOTE_EXPIRE_OPTIONS_SEC: [300, 3600, 86400, 604800],
  NOTE_DEFAULT_EXPIRE_SEC: 86400,
  NOTE_VIEW_OPTIONS: [0, 1, 2, 3, 5, 10, 20, 50, 100],
  NOTE_DEFAULT_VIEWS: 0,
  CLEANUP_INTERVAL: 60,
  CUSTOM_TITLE: "SkySend",
  RATE_LIMIT_WINDOW: 60000,
  RATE_LIMIT_MAX: 60,
  TRUST_PROXY: false,
  ENABLED_SERVICES: ["file", "note"] as ("file" | "note")[],
};

function createApp() {
  const app = new Hono();
  app.route("/api/note", createNoteRoute(mockLockout));
  return app;
}

function validNotePayload(overrides: Record<string, unknown> = {}) {
  return {
    encryptedContent: Buffer.from("test-encrypted-content").toString("base64"),
    nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64"),
    salt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url"),
    ownerToken: fakeBase64urlToken(),
    authToken: fakeBase64urlToken(),
    contentType: "text",
    maxViews: 1,
    expireSec: 3600,
    hasPassword: false,
    ...overrides,
  };
}

describe("note routes", () => {
  let dbCtx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    dbCtx = createTestDb();
    vi.mocked(getDb).mockReturnValue(dbCtx.db);
    vi.mocked(getConfig).mockReturnValue(DEFAULT_CONFIG);
  });

  afterEach(() => {
    dbCtx.cleanup();
    vi.restoreAllMocks();
  });

  // ── POST /api/note (create) ─────────────────────────

  describe("POST /api/note", () => {
    it("should create a note and return id + expiresAt", async () => {
      const app = createApp();
      const payload = validNotePayload();

      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.expiresAt).toBeTruthy();

      // Verify in DB
      const note = await dbCtx.db.query.notes.findFirst({
        where: eq(notes.id, body.id),
      });
      expect(note).toBeDefined();
      expect(note!.contentType).toBe("text");
      expect(note!.maxViews).toBe(1);
      expect(note!.viewCount).toBe(0);
    });

    it("should create notes for all content types", async () => {
      const app = createApp();

      for (const contentType of ["text", "password", "code"]) {
        const res = await app.request("/api/note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validNotePayload({ contentType })),
        });
        expect(res.status).toBe(201);
      }
    });

    it("should reject invalid JSON body", async () => {
      const app = createApp();
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    it("should reject missing required fields", async () => {
      const app = createApp();
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encryptedContent: "abc" }),
      });
      expect(res.status).toBe(400);
    });

    it("should reject invalid content type", async () => {
      const app = createApp();
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validNotePayload({ contentType: "invalid" })),
      });
      expect(res.status).toBe(400);
    });

    it("should reject invalid expiry time", async () => {
      const app = createApp();
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validNotePayload({ expireSec: 9999 })),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("expiry");
    });

    it("should reject invalid view limit", async () => {
      const app = createApp();
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validNotePayload({ maxViews: 999 })),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("view");
    });

    it("should reject oversized note content", async () => {
      const app = createApp();
      // Create content bigger than NOTE_MAX_SIZE + 256
      const bigContent = Buffer.alloc(1024 ** 2 + 512).toString("base64");
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validNotePayload({ encryptedContent: bigContent })),
      });
      expect(res.status).toBe(413);
    });

    it("should reject invalid nonce length", async () => {
      const app = createApp();
      const badNonce = Buffer.from(new Uint8Array(8)).toString("base64");
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validNotePayload({ nonce: badNonce })),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Nonce");
    });

    it("should reject invalid salt length", async () => {
      const app = createApp();
      const badSalt = Buffer.from(new Uint8Array(8)).toString("base64url");
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validNotePayload({ salt: badSalt })),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Salt");
    });

    it("should require password fields when hasPassword is true", async () => {
      const app = createApp();
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validNotePayload({ hasPassword: true })),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("password");
    });

    it("should accept password-protected note with valid fields", async () => {
      const app = createApp();
      const passwordSalt = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validNotePayload({
            hasPassword: true,
            passwordSalt,
            passwordAlgo: "pbkdf2",
          }),
        ),
      });
      expect(res.status).toBe(201);
    });
  });

  // ── GET /api/note/:id (info) ────────────────────────

  describe("GET /api/note/:id", () => {
    it("should return note info without content", async () => {
      const app = createApp();
      const authToken = fakeBase64urlToken();
      insertTestNote(dbCtx.db, { id: TEST_UUID, authToken });

      const res = await app.request(`/api/note/${TEST_UUID}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(TEST_UUID);
      expect(body.contentType).toBe("text");
      expect(body.hasPassword).toBe(false);
      expect(body.maxViews).toBe(10);
      expect(body.viewCount).toBe(0);
      expect(body.expiresAt).toBeTruthy();
      expect(body.salt).toBeTruthy();
      // Should NOT include content
      expect(body.encryptedContent).toBeUndefined();
    });

    it("should return 404 for non-existent note", async () => {
      const app = createApp();
      const res = await app.request("/api/note/nonexistent-id");
      expect(res.status).toBe(404);
    });

    it("should return 410 for expired note", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, {
        id: TEST_UUID,
        expiresAt: new Date(Date.now() - 1000),
      });

      const res = await app.request(`/api/note/${TEST_UUID}`);
      expect(res.status).toBe(410);
    });

    it("should return 410 for note that reached view limit", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, {
        id: TEST_UUID,
        maxViews: 5,
        viewCount: 5,
      });

      const res = await app.request(`/api/note/${TEST_UUID}`);
      expect(res.status).toBe(410);
    });

    it("should include password fields for password-protected note", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, {
        id: TEST_UUID,
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "argon2id",
      });

      const res = await app.request(`/api/note/${TEST_UUID}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.hasPassword).toBe(true);
      expect(body.passwordAlgo).toBe("argon2id");
      expect(body.passwordSalt).toBeTruthy();
    });
  });

  // ── POST /api/note/:id/view ─────────────────────────

  describe("POST /api/note/:id/view", () => {
    it("should return encrypted content and increment view count", async () => {
      const app = createApp();
      const authToken = fakeBase64urlToken();
      insertTestNote(dbCtx.db, { id: TEST_UUID, authToken });

      const res = await app.request(`/api/note/${TEST_UUID}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.encryptedContent).toBeTruthy();
      expect(body.nonce).toBeTruthy();
      expect(body.viewCount).toBe(1);
      expect(body.maxViews).toBe(10);

      // Verify view count was incremented in DB
      const note = await dbCtx.db.query.notes.findFirst({
        where: eq(notes.id, TEST_UUID),
      });
      expect(note!.viewCount).toBe(1);
    });

    it("should reject invalid auth token", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, { id: TEST_UUID, authToken: fakeBase64urlToken() });

      const res = await app.request(`/api/note/${TEST_UUID}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });

      expect(res.status).toBe(401);
    });

    it("should return 404 for non-existent note", async () => {
      const app = createApp();
      const res = await app.request("/api/note/nonexistent/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });
      expect(res.status).toBe(404);
    });

    it("should return 410 for expired note", async () => {
      const app = createApp();
      const authToken = fakeBase64urlToken();
      insertTestNote(dbCtx.db, {
        id: TEST_UUID,
        authToken,
        expiresAt: new Date(Date.now() - 1000),
      });

      const res = await app.request(`/api/note/${TEST_UUID}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken }),
      });

      expect(res.status).toBe(410);
    });

    it("should enforce burn-after-reading (maxViews=1)", async () => {
      const app = createApp();
      const authToken = fakeBase64urlToken();
      insertTestNote(dbCtx.db, { id: TEST_UUID, authToken, maxViews: 1 });

      // First view should succeed
      const res1 = await app.request(`/api/note/${TEST_UUID}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken }),
      });
      expect(res1.status).toBe(200);
      const body1 = await res1.json();
      expect(body1.viewCount).toBe(1);
      expect(body1.maxViews).toBe(1);

      // Second view should fail with 410
      const res2 = await app.request(`/api/note/${TEST_UUID}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken }),
      });
      expect(res2.status).toBe(410);
    });

    it("should allow unlimited views when maxViews=0", async () => {
      const app = createApp();
      const authToken = fakeBase64urlToken();
      insertTestNote(dbCtx.db, { id: TEST_UUID, authToken, maxViews: 0 });

      // View multiple times - should always succeed
      for (let i = 1; i <= 5; i++) {
        const res = await app.request(`/api/note/${TEST_UUID}/view`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authToken }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.viewCount).toBe(i);
        expect(body.maxViews).toBe(0);
      }
    });

    it("should allow creating a note with maxViews=0", async () => {
      const app = createApp();
      const res = await app.request("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validNotePayload({ maxViews: 0 })),
      });
      expect(res.status).toBe(201);
    });

    it("should atomically increment view count", async () => {
      const app = createApp();
      const authToken = fakeBase64urlToken();
      insertTestNote(dbCtx.db, { id: TEST_UUID, authToken, maxViews: 3 });

      // Make 3 sequential views
      for (let i = 1; i <= 3; i++) {
        const res = await app.request(`/api/note/${TEST_UUID}/view`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authToken }),
        });
        if (i <= 3) {
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.viewCount).toBe(i);
        }
      }

      // 4th view should fail
      const res4 = await app.request(`/api/note/${TEST_UUID}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken }),
      });
      expect(res4.status).toBe(410);
    });

    it("should reject missing authToken in body", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, { id: TEST_UUID });

      const res = await app.request(`/api/note/${TEST_UUID}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("should return 401 when authToken is not valid base64url", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, { id: TEST_UUID, authToken: fakeBase64urlToken() });

      const res = await app.request(`/api/note/${TEST_UUID}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: "!!!not-valid-base64url!!!" }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Invalid auth token format");
    });

    it("should lock after repeated failed view attempts and return 429", async () => {
      const authToken = fakeBase64urlToken();
      insertTestNote(dbCtx.db, { id: TEST_UUID, authToken });

      const strictLockout = createPasswordLockout(3, 60_000);
      const app = new Hono();
      app.route("/api/note", createNoteRoute(strictLockout));

      // 3 failed attempts with wrong tokens
      for (let i = 0; i < 3; i++) {
        const res = await app.request(`/api/note/${TEST_UUID}/view`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authToken: fakeBase64urlToken() }),
        });
        expect(res.status).toBe(401);
      }

      // 4th attempt (even with correct token) should be locked
      const lockedRes = await app.request(`/api/note/${TEST_UUID}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken }),
      });

      expect(lockedRes.status).toBe(429);
      expect(lockedRes.headers.get("Retry-After")).toBeTruthy();
    });
  });

  // ── POST /api/note/:id/password ─────────────────────

  describe("POST /api/note/:id/password", () => {
    it("should verify correct password (auth token)", async () => {
      const app = createApp();
      const authToken = fakeBase64urlToken();
      insertTestNote(dbCtx.db, {
        id: TEST_UUID,
        authToken,
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "pbkdf2",
      });

      const res = await app.request(`/api/note/${TEST_UUID}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("should reject wrong password (auth token)", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, {
        id: TEST_UUID,
        authToken: fakeBase64urlToken(),
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "pbkdf2",
      });

      const res = await app.request(`/api/note/${TEST_UUID}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });

      expect(res.status).toBe(401);
    });

    it("should reject password verification on non-password note", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, { id: TEST_UUID, hasPassword: false });

      const res = await app.request(`/api/note/${TEST_UUID}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 404 for non-existent note", async () => {
      const app = createApp();
      const res = await app.request("/api/note/nonexistent/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });
      expect(res.status).toBe(404);
    });

    it("should return 410 for expired note", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, {
        id: TEST_UUID,
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "pbkdf2",
        expiresAt: new Date(Date.now() - 1000),
      });

      const res = await app.request(`/api/note/${TEST_UUID}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });
      expect(res.status).toBe(410);
    });
    it("should return 400 when authToken is missing from body", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, {
        id: TEST_UUID,
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "pbkdf2",
      });

      const res = await app.request(`/api/note/${TEST_UUID}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("authToken");
    });

    it("should return 401 when authToken is not valid base64url", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, {
        id: TEST_UUID,
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "pbkdf2",
      });

      const res = await app.request(`/api/note/${TEST_UUID}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: "!!!not-valid-base64url!!!" }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Invalid auth token format");
    });

    it("should lock after repeated failed password attempts and return 429", async () => {
      insertTestNote(dbCtx.db, {
        id: TEST_UUID,
        hasPassword: true,
        passwordSalt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))),
        passwordAlgo: "pbkdf2",
      });

      const strictLockout = createPasswordLockout(3, 60_000);
      const app = new Hono();
      app.route("/api/note", createNoteRoute(strictLockout));

      // 3 failed attempts with wrong tokens
      for (let i = 0; i < 3; i++) {
        const res = await app.request(`/api/note/${TEST_UUID}/password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authToken: fakeBase64urlToken() }),
        });
        expect(res.status).toBe(401);
      }

      // 4th attempt should be locked
      const lockedRes = await app.request(`/api/note/${TEST_UUID}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: fakeBase64urlToken() }),
      });

      expect(lockedRes.status).toBe(429);
      expect(lockedRes.headers.get("Retry-After")).toBeTruthy();
    });  });

  // ── DELETE /api/note/:id ────────────────────────────

  describe("DELETE /api/note/:id", () => {
    it("should delete note with valid owner token", async () => {
      const app = createApp();
      const ownerToken = fakeBase64urlToken();
      insertTestNote(dbCtx.db, { id: TEST_UUID, ownerToken });

      const res = await app.request(`/api/note/${TEST_UUID}`, {
        method: "DELETE",
        headers: { "X-Owner-Token": ownerToken },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify deletion
      const note = await dbCtx.db.query.notes.findFirst({
        where: eq(notes.id, TEST_UUID),
      });
      expect(note).toBeUndefined();
    });

    it("should reject wrong owner token", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, { id: TEST_UUID, ownerToken: fakeBase64urlToken() });

      const res = await app.request(`/api/note/${TEST_UUID}`, {
        method: "DELETE",
        headers: { "X-Owner-Token": fakeBase64urlToken() },
      });

      expect(res.status).toBe(401);
    });

    it("should reject missing owner token", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, { id: TEST_UUID });

      const res = await app.request(`/api/note/${TEST_UUID}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(401);
    });

    it("should return 404 for non-existent note", async () => {
      const app = createApp();
      const res = await app.request("/api/note/nonexistent", {
        method: "DELETE",
        headers: { "X-Owner-Token": fakeBase64urlToken() },
      });

      expect(res.status).toBe(404);
    });

    it("should return 401 when owner token is not valid base64url", async () => {
      const app = createApp();
      insertTestNote(dbCtx.db, { id: TEST_UUID, ownerToken: fakeBase64urlToken() });

      const res = await app.request(`/api/note/${TEST_UUID}`, {
        method: "DELETE",
        headers: { "X-Owner-Token": "!!!not-valid-base64url!!!" },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Invalid owner token format");
    });
  });
});
