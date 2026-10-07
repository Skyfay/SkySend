import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import type { UpgradeWebSocket, WSEvents } from "hono/ws";
import { eq } from "drizzle-orm";
import {
  createFileRequest,
  deriveInboxKeys,
  generateSalt,
  generateSecret,
  openRequestKey,
  toBase64url,
  unwrapFileSecret,
  wrapFileSecret,
  type NewFileRequest,
} from "@skysend/crypto";
import { createTestDb, createTestStorage, fakeBase64urlToken } from "./helpers.js";
import { createFakeWs, createMockUpgrade, msgEvent } from "./ws-helpers.js";
import { fileRequests, requestUploads } from "../src/db/schema.js";
import type { FileStorage } from "../src/storage/filesystem.js";

vi.mock("../src/db/index.js", () => ({
  getDb: vi.fn(),
  initDatabase: vi.fn(),
}));

vi.mock("../src/lib/config.js", () => ({
  getConfig: vi.fn(),
  loadConfig: vi.fn(),
}));

import { getDb } from "../src/db/index.js";
import { getConfig, type Config } from "../src/lib/config.js";
import { createRequestRoute } from "../src/routes/request.js";
import { createInboxRoute } from "../src/routes/inbox.js";
import { createDownloadRoute } from "../src/routes/download.js";
import { infoRoute } from "../src/routes/info.js";
import { existsRoute } from "../src/routes/exists.js";
import { createRequestLimiter, type RequestLimiter } from "../src/lib/request-limit.js";
import { createPasswordLockout, type PasswordLockout } from "../src/lib/password-lockout.js";
import { runCleanup } from "../src/lib/cleanup.js";
import { hashToken } from "../src/lib/request-validation.js";

const DEFAULT_CONFIG = {
  FILE_MAX_SIZE: 1024 * 1024,
  FILE_MAX_FILES_PER_UPLOAD: 32,
  FILE_UPLOAD_CONCURRENT_CHUNKS: 3,
  FILE_UPLOAD_SPEED_LIMIT: 0,
  FILE_REQUEST_EXPIRE_OPTIONS_SEC: [86400, 259200, 604800],
  FILE_REQUEST_DEFAULT_EXPIRE_SEC: 259200,
  FILE_REQUEST_UPLOAD_OPTIONS: [1, 2, 3, 5, 10],
  FILE_REQUEST_DEFAULT_UPLOADS: 10,
  FILE_REQUEST_MAX_SIZE: 10 * 1024 * 1024,
  FILE_REQUEST_RETENTION_SEC: 604800,
  FILE_REQUEST_DOWNLOAD_OPTIONS: [1, 2, 5],
  FILE_REQUEST_DEFAULT_DOWNLOADS: 5,
  FILE_REQUEST_DAILY_LIMIT: 10,
  FORCE_FILE_PASSWORD: false,
  FORCE_REQUEST_PASSWORD: false,
  TRUST_PROXY: false,
  ENABLED_SERVICES: ["file", "note", "request"],
  BASE_URL: "http://localhost:3000",
  CORS_ORIGINS: [],
  FILE_UPLOAD_WS_MAX_BUFFER: 16 * 1024 * 1024,
} as unknown as Config;

const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** The body a browser sends to create a request. */
function createBody(request: NewFileRequest, overrides: Record<string, unknown> = {}) {
  const { server } = request;
  return {
    vault: toBase64url(server.vault),
    vaultNonce: toBase64url(server.vaultNonce),
    inboxAuthToken: toBase64url(server.inboxAuthToken),
    inboxOwnerToken: toBase64url(server.inboxOwnerToken),
    uploadToken: toBase64url(server.uploadToken),
    brief: {
      ciphertext: toBase64url(server.brief.ciphertext),
      nonce: toBase64url(server.brief.nonce),
    },
    expireSec: 86400,
    maxUploads: 3,
    maxSize: 4096,
    downloads: 5,
    ...overrides,
  };
}

describe("file requests", () => {
  let dbCtx: ReturnType<typeof createTestDb>;
  let storageCtx: Awaited<ReturnType<typeof createTestStorage>>;
  let storage: FileStorage;
  let limiter: RequestLimiter;
  let lockout: PasswordLockout;
  let recorded: Array<[string, number]>;

  /** The two request routes the way src/index.ts mounts them, plus the routes of normal uploads. */
  function createApp(
    options: {
      createGuard?: MiddlewareHandler;
      quota?: boolean;
      upgradeWebSocket?: UpgradeWebSocket;
      quotaRefusal?: string;
    } = {},
  ) {
    const app = new Hono();
    app.route(
      "/api/request",
      createRequestRoute({
        storage,
        limiter,
        chunkDir: join(storageCtx.tempDir, "request-chunks"),
        createGuard: options.createGuard,
        quota: options.quota
          ? {
              middleware: async (c, next) => {
                c.set("quotaHashedIp", "hashed-ip");
                await next();
              },
              recordUsage: (ip, bytes) => recorded.push([ip, bytes]),
              check: () =>
                options.quotaRefusal
                  ? { ok: false as const, reason: options.quotaRefusal }
                  : { ok: true as const, hashedIp: "hashed-ip" },
            }
          : undefined,
        upgradeWebSocket: options.upgradeWebSocket,
      }),
    );
    app.route("/api/inbox", createInboxRoute({ storage, lockout }));
    app.route("/api/download", createDownloadRoute(storage));
    app.route("/api/info", infoRoute);
    app.route("/api/exists", existsRoute);
    return app;
  }

  /** Creates a request through the API and returns its ID with everything a link carries. */
  async function createRequest(app: Hono, overrides: Record<string, unknown> = {}) {
    const request = await createFileRequest({ title: "Tax documents 2026" });
    const res = await app.request("/api/request", json(createBody(request, overrides)));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const upload = { "X-Upload-Token": toBase64url(request.server.uploadToken) };
    const inbox = { "X-Inbox-Token": toBase64url(request.server.inboxAuthToken) };
    const owner = { "X-Inbox-Owner-Token": toBase64url(request.server.inboxOwnerToken) };
    return { id, request, headers: { upload, inbox, owner } };
  }

  /** Opens an upload session into a request. */
  function init(app: Hono, id: string, uploadHeaders: Record<string, string>, size: number) {
    return app.request(`/api/request/${id}/upload/init`, {
      method: "POST",
      headers: {
        ...uploadHeaders,
        "X-Salt": toBase64url(generateSalt()),
        "X-Content-Length": String(size),
      },
    });
  }

  /** What a sender sends at finalize: a wrapped file secret and encrypted metadata. */
  async function finalizeBody(
    publicKey: Uint8Array,
    requestId: string,
    uploadId: string,
    fileSecret: Uint8Array,
  ) {
    const wrapped = await wrapFileSecret(publicKey, requestId, uploadId, fileSecret);
    return {
      wrapEnc: toBase64url(wrapped.enc),
      wrapCiphertext: toBase64url(wrapped.ciphertext),
      encryptedMeta: toBase64url(crypto.getRandomValues(new Uint8Array(40))),
      metaNonce: toBase64url(crypto.getRandomValues(new Uint8Array(12))),
    };
  }

  /** Uploads `data` into a request from start to finish and returns the upload ID. */
  async function uploadInto(
    app: Hono,
    created: Awaited<ReturnType<typeof createRequest>>,
    data: Uint8Array,
    fileSecret = generateSecret(),
  ) {
    const opened = await init(app, created.id, created.headers.upload, data.byteLength);
    expect(opened.status).toBe(201);
    const { id: uid } = (await opened.json()) as { id: string };
    const chunk = await app.request(`/api/request/${created.id}/upload/${uid}/chunk?index=0`, {
      method: "POST",
      headers: { ...created.headers.upload, "Content-Length": String(data.byteLength) },
      body: data,
    });
    expect(chunk.status).toBe(200);
    const body = await finalizeBody(created.request.local.publicKey, created.id, uid, fileSecret);
    const done = await app.request(`/api/request/${created.id}/upload/${uid}/finalize`, json(body));
    expect(done.status).toBe(200);
    return uid;
  }

  function requestRow(id: string) {
    return dbCtx.db.select().from(fileRequests).where(eq(fileRequests.id, id)).get()!;
  }

  beforeEach(async () => {
    dbCtx = createTestDb();
    storageCtx = await createTestStorage();
    storage = storageCtx.storage;
    limiter = createRequestLimiter(10);
    lockout = createPasswordLockout(3, 60_000);
    recorded = [];
    vi.mocked(getDb).mockReturnValue(dbCtx.db);
    vi.mocked(getConfig).mockReturnValue(DEFAULT_CONFIG);
  });

  afterEach(() => {
    dbCtx.cleanup();
    storageCtx.cleanup();
    vi.restoreAllMocks();
  });

  // ── Creating a request ──────────────────────────────

  describe("POST /api/request", () => {
    it("stores the request without any secret of the links", async () => {
      const app = createApp();
      const { id, request } = await createRequest(app);
      const row = requestRow(id);
      expect(row.maxUploads).toBe(3);
      expect(row.maxSize).toBe(4096);
      expect(row.reservedUploads).toBe(0);
      // The database keeps the hashes of the tokens, never the tokens themselves.
      expect(row.uploadToken).toBe(hashToken(request.server.uploadToken));
      const stored = JSON.stringify(row);
      for (const value of [
        ...Object.values(request.local),
        request.server.uploadToken,
        request.server.inboxAuthToken,
        request.server.inboxOwnerToken,
      ]) {
        expect(stored).not.toContain(toBase64url(value));
      }
    });

    it("requires a brief of a sound length", async () => {
      const app = createApp();
      const request = await createFileRequest();
      const nonce = toBase64url(request.server.brief.nonce);
      for (const brief of [
        undefined,
        null,
        { ciphertext: toBase64url(new Uint8Array(1024 + 15)), nonce },
        { ciphertext: toBase64url(new Uint8Array(1024 + 17)), nonce },
        { ciphertext: toBase64url(new Uint8Array(8 * 1024 + 17)), nonce },
        { ciphertext: toBase64url(request.server.brief.ciphertext), nonce: "x" },
        { ciphertext: toBase64url(request.server.brief.ciphertext), nonce, extra: 1 },
      ]) {
        const res = await app.request("/api/request", json(createBody(request, { brief })));
        expect(res.status).toBe(400);
      }
      const largest = { ciphertext: toBase64url(new Uint8Array(8 * 1024 + 16)), nonce };
      expect(
        (await app.request("/api/request", json(createBody(request, { brief: largest })))).status,
      ).toBe(201);
    });

    it("rejects a vault of the wrong length", async () => {
      const app = createApp();
      const request = await createFileRequest();
      const res = await app.request(
        "/api/request",
        json(createBody(request, { vault: toBase64url(new Uint8Array(145)) })),
      );
      expect(res.status).toBe(400);
    });

    it("rejects a token that is not canonical base64url", async () => {
      const app = createApp();
      const request = await createFileRequest();
      const token = toBase64url(request.server.uploadToken);
      const res = await app.request(
        "/api/request",
        json(createBody(request, { uploadToken: `${token}=` })),
      );
      expect(res.status).toBe(400);
    });

    it("rejects unknown fields", async () => {
      const app = createApp();
      const request = await createFileRequest();
      const res = await app.request("/api/request", json(createBody(request, { publicKey: "x" })));
      expect(res.status).toBe(400);
    });

    it("rejects an expiry that is not one of the options", async () => {
      const app = createApp();
      const request = await createFileRequest();
      const res = await app.request("/api/request", json(createBody(request, { expireSec: 3600 })));
      expect(res.status).toBe(400);
    });

    it("takes only the uploads and downloads the server offers, and refuses more bytes", async () => {
      const app = createApp();
      const request = await createFileRequest();
      const create = (overrides: Record<string, unknown>) =>
        app.request("/api/request", json(createBody(request, overrides)));
      for (const maxUploads of [11, 4 + 3, 0]) {
        expect((await create({ maxUploads })).status).toBe(400);
      }
      // An option counts twice as well: the submissions of a request for files and a note.
      expect((await create({ maxUploads: 20 })).status).toBe(201);
      expect((await create({ maxUploads: 6 })).status).toBe(201);
      expect((await create({ downloads: 3 })).status).toBe(400);
      expect((await create({ downloads: undefined })).status).toBe(400);
      const tooLarge = await app.request(
        "/api/request",
        json(createBody(request, { maxSize: DEFAULT_CONFIG.FILE_REQUEST_MAX_SIZE + 1 })),
      );
      expect(tooLarge.status).toBe(400);
    });

    it("requires a password when FORCE_REQUEST_PASSWORD is set, not FORCE_FILE_PASSWORD", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, FORCE_FILE_PASSWORD: true });
      const app = createApp();
      const request = await createFileRequest();
      expect((await app.request("/api/request", json(createBody(request)))).status).toBe(201);
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, FORCE_REQUEST_PASSWORD: true });
      const without = await app.request("/api/request", json(createBody(request)));
      expect(without.status).toBe(400);
      const withPassword = await app.request(
        "/api/request",
        json(createBody(request, { hasPassword: true })),
      );
      expect(withPassword.status).toBe(201);
    });

    it("stops at the daily limit", async () => {
      limiter = createRequestLimiter(2);
      const app = createApp();
      const request = await createFileRequest();
      expect((await app.request("/api/request", json(createBody(request)))).status).toBe(201);
      expect((await app.request("/api/request", json(createBody(request)))).status).toBe(201);
      expect((await app.request("/api/request", json(createBody(request)))).status).toBe(429);
    });

    it("tells the caller how many new requests are left today", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, FILE_REQUEST_DAILY_LIMIT: 2 });
      limiter = createRequestLimiter(2);
      const app = createApp();
      const left = async () => (await (await app.request("/api/request/limit")).json()) as object;
      expect(await left()).toEqual({ dailyLimit: 2, remaining: 2, resetsAt: null });
      const request = await createFileRequest();
      await app.request("/api/request", json(createBody(request)));
      // The end of the day stays hidden while some are left, so it tells nobody behind the
      // same IP when another made a request.
      expect(await left()).toEqual({ dailyLimit: 2, remaining: 1, resetsAt: null });
      // Asking counts nothing.
      expect(await left()).toMatchObject({ remaining: 1 });
      await app.request("/api/request", json(createBody(request)));
      expect(await left()).toMatchObject({
        remaining: 0,
        resetsAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      });
    });

    it("needs the login for the daily limit too, when creating needs it", async () => {
      const guard: MiddlewareHandler = async (c, next) => {
        if (c.req.header("Authorization") !== "Bearer ok")
          return c.json({ error: "Authentication required" }, 401);
        await next();
      };
      const app = createApp({ createGuard: guard });
      expect((await app.request("/api/request/limit")).status).toBe(401);
      const res = await app.request("/api/request/limit", {
        headers: { Authorization: "Bearer ok" },
      });
      expect(res.status).toBe(200);
    });

    it("tells the caller there is no limit when it is off", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, FILE_REQUEST_DAILY_LIMIT: 0 });
      limiter = createRequestLimiter(0);
      const res = await createApp().request("/api/request/limit");
      expect(await res.json()).toEqual({ dailyLimit: 0, remaining: null, resetsAt: null });
    });

    it("needs the login only for creating, when a guard is set", async () => {
      const guard: MiddlewareHandler = async (c, next) => {
        if (c.req.header("Authorization") !== "Bearer ok")
          return c.json({ error: "Authentication required" }, 401);
        await next();
      };
      const app = createApp({ createGuard: guard });
      const request = await createFileRequest();
      const body = json(createBody(request));

      expect((await app.request("/api/request", body)).status).toBe(401);
      // Other spellings of the path must not reach the handler without the guard.
      expect((await app.request("/api/request/", body)).status).not.toBe(201);
      expect((await app.request("/api/request//", body)).status).not.toBe(201);
      expect((await app.request("/api/request?x=1", body)).status).toBe(401);

      const res = await app.request("/api/request", {
        ...body,
        headers: { ...body.headers, Authorization: "Bearer ok" },
      });
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };

      // A sender uploads without any login.
      const upload = { "X-Upload-Token": toBase64url(request.server.uploadToken) };
      expect((await app.request(`/api/request/${id}`, { headers: upload })).status).toBe(200);
      expect((await init(app, id, upload, 10)).status).toBe(201);
    });

    it("is off when ENABLED_SERVICES leaves out request", async () => {
      vi.mocked(getConfig).mockReturnValue({
        ...DEFAULT_CONFIG,
        ENABLED_SERVICES: ["file", "note"],
      });
      const app = createApp();
      const request = await createFileRequest();
      expect((await app.request("/api/request", json(createBody(request)))).status).toBe(403);
      expect((await app.request(`/api/request/${crypto.randomUUID()}`)).status).toBe(403);
      expect((await app.request(`/api/inbox/${crypto.randomUUID()}`)).status).toBe(403);
    });
  });

  // ── What a sender sees ──────────────────────────────

  describe("GET /api/request/:id", () => {
    it("returns the brief and the limits of an upload", async () => {
      const app = createApp();
      const { id, request, headers } = await createRequest(app);
      const res = await app.request(`/api/request/${id}`, { headers: headers.upload });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        open: true,
        uploadsLeft: 3,
        maxUploadSize: 4096,
        maxFilesPerUpload: 32,
      });
      expect(body.brief).toEqual({
        ciphertext: toBase64url(request.server.brief.ciphertext),
        nonce: toBase64url(request.server.brief.nonce),
      });
      expect(JSON.stringify(body)).not.toContain(toBase64url(request.server.vault));
    });

    it("looks like a missing request without the right upload token", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app);
      expect((await app.request(`/api/request/${id}`)).status).toBe(404);
      expect(
        (
          await app.request(`/api/request/${id}`, {
            headers: { "X-Upload-Token": fakeBase64urlToken() },
          })
        ).status,
      ).toBe(404);
      // The inbox token opens nothing on the sender side.
      expect(
        (
          await app.request(`/api/request/${id}`, {
            headers: { "X-Upload-Token": headers.inbox["X-Inbox-Token"] },
          })
        ).status,
      ).toBe(404);
      expect(
        (await app.request("/api/request/not-a-uuid", { headers: headers.upload })).status,
      ).toBe(404);
    });

    it("answers no brief for a row a development build wrote before briefs", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app);
      dbCtx.db
        .update(fileRequests)
        .set({ briefCiphertext: null, briefNonce: null })
        .where(eq(fileRequests.id, id))
        .run();
      const view = await app.request(`/api/request/${id}`, { headers: headers.upload });
      expect(((await view.json()) as { brief: unknown }).brief).toBeNull();
    });

    it("looks like a missing request once it was deleted", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app);
      await app.request(`/api/inbox/${id}`, { method: "DELETE", headers: headers.owner });
      expect((await app.request(`/api/request/${id}`, { headers: headers.upload })).status).toBe(
        404,
      );
    });

    it("reports a closed request", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app);
      await app.request(`/api/inbox/${id}/close`, { method: "POST", headers: headers.owner });
      const body = (await (
        await app.request(`/api/request/${id}`, { headers: headers.upload })
      ).json()) as Record<string, unknown>;
      expect(body).toMatchObject({ open: false, uploadsLeft: 0, maxUploadSize: 0 });
    });
  });

  // ── Uploading into a request ────────────────────────

  describe("uploads", () => {
    it("goes from the sender to the inbox and only the requester can unwrap it", async () => {
      const app = createApp({ quota: true });
      const created = await createRequest(app);
      const data = crypto.getRandomValues(new Uint8Array(1000));
      const fileSecret = generateSecret();
      const uid = await uploadInto(app, created, data, fileSecret);

      const listed = await app.request(`/api/inbox/${created.id}`, {
        headers: created.headers.inbox,
      });
      expect(listed.status).toBe(200);
      const inbox = (await listed.json()) as {
        vault: string;
        vaultNonce: string;
        usedUploads: number;
        usedBytes: number;
        uploads: Array<Record<string, string | number>>;
      };
      expect(inbox.usedUploads).toBe(1);
      expect(inbox.usedBytes).toBe(1000);
      expect(inbox.uploads).toHaveLength(1);
      const entry = inbox.uploads[0]!;
      expect(entry).toMatchObject({
        id: uid,
        size: 1000,
        fileCount: 1,
        downloadCount: 0,
        maxDownloads: 5,
      });

      const { inboxKey } = await deriveInboxKeys(created.request.local.inboxSecret);
      const { fromBase64url } = await import("@skysend/crypto");
      const key = await openRequestKey(
        fromBase64url(inbox.vault),
        fromBase64url(inbox.vaultNonce),
        inboxKey,
        created.request.server.brief,
      );
      const unwrapped = await unwrapFileSecret(key, created.id, uid, {
        enc: fromBase64url(entry.wrapEnc as string),
        ciphertext: fromBase64url(entry.wrapCiphertext as string),
      });
      expect(unwrapped).toEqual(fileSecret);

      const file = await app.request(`/api/inbox/${created.id}/file/${uid}`, {
        headers: created.headers.inbox,
      });
      expect(file.status).toBe(200);
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(data);
      expect(recorded).toEqual([["hashed-ip", 1000]]);
    });

    it("counts downloads as the request set them, but never a listing", async () => {
      const app = createApp();
      const created = await createRequest(app, { downloads: 1 });
      const uid = await uploadInto(app, created, new Uint8Array(10));

      for (let i = 0; i < 3; i++) {
        await app.request(`/api/inbox/${created.id}`, { headers: created.headers.inbox });
      }
      const file = `/api/inbox/${created.id}/file/${uid}`;
      expect((await app.request(file, { headers: created.headers.inbox })).status).toBe(200);
      expect((await app.request(file, { headers: created.headers.inbox })).status).toBe(410);
      const inbox = (await (
        await app.request(`/api/inbox/${created.id}`, { headers: created.headers.inbox })
      ).json()) as {
        uploads: unknown[];
      };
      expect(inbox.uploads).toHaveLength(0);
    });

    it("never lets parallel senders take more slots than the request has", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app, { maxUploads: 2 });
      const results = await Promise.all([1, 2, 3, 4].map(() => init(app, id, headers.upload, 10)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 409, 409]);
      expect(requestRow(id).reservedUploads).toBe(2);
    });

    describe("submissions", () => {
      /** Uploads one part of a submission and returns what finalize answered. */
      async function sendPart(
        app: Hono,
        created: Awaited<ReturnType<typeof createRequest>>,
        extra: Record<string, string>,
      ) {
        const opened = await init(app, created.id, { ...created.headers.upload, ...extra }, 10);
        expect(opened.status).toBe(201);
        const { id: uid } = (await opened.json()) as { id: string };
        await app.request(`/api/request/${created.id}/upload/${uid}/chunk?index=0`, {
          method: "POST",
          headers: { ...created.headers.upload, "Content-Length": "10" },
          body: new Uint8Array(10),
        });
        const body = await finalizeBody(
          created.request.local.publicKey,
          created.id,
          uid,
          generateSecret(),
        );
        const done = await app.request(
          `/api/request/${created.id}/upload/${uid}/finalize`,
          json(body),
        );
        expect(done.status).toBe(200);
        return (await done.json()) as { id: string; hold?: string };
      }

      it("reserves both slots of a submission and holds the second for its note", async () => {
        const app = createApp();
        const created = await createRequest(app, { maxUploads: 2 });
        const files = await sendPart(app, created, { "X-Reserve-Next": "1" });
        expect(files.hold).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(requestRow(created.id).reservedUploads).toBe(2);
        // Another sender finds the request full, and the note still finds its slot.
        expect((await init(app, created.id, created.headers.upload, 10)).status).toBe(409);
        const note = await sendPart(app, created, { "X-Slot-Hold": files.hold! });
        expect(note.hold).toBeUndefined();
        expect(requestRow(created.id)).toMatchObject({ reservedUploads: 2, finishedUploads: 2 });
      });

      it("refuses the first part when the request has no room for its second", async () => {
        const app = createApp();
        const created = await createRequest(app, { maxUploads: 2 });
        expect((await init(app, created.id, created.headers.upload, 10)).status).toBe(201);
        const both = { ...created.headers.upload, "X-Reserve-Next": "1" };
        expect((await init(app, created.id, both, 10)).status).toBe(409);
        expect(requestRow(created.id).reservedUploads).toBe(1);
      });

      it("takes a hold once and only for its own request", async () => {
        const app = createApp();
        const created = await createRequest(app, { maxUploads: 2 });
        const other = await createRequest(app, { maxUploads: 2 });
        const { hold } = await sendPart(app, created, { "X-Reserve-Next": "1" });
        // Another request does not know the hold, so it takes a slot of its own.
        const foreign = { ...other.headers.upload, "X-Slot-Hold": hold! };
        expect((await init(app, other.id, foreign, 10)).status).toBe(201);
        expect(requestRow(other.id).reservedUploads).toBe(1);
        const withHold = { ...created.headers.upload, "X-Slot-Hold": hold! };
        expect((await init(app, created.id, withHold, 10)).status).toBe(201);
        expect((await init(app, created.id, withHold, 10)).status).toBe(409);
        expect(requestRow(created.id).reservedUploads).toBe(2);
      });

      it("gives the held slot back to its hold when the note is cancelled", async () => {
        const app = createApp();
        const created = await createRequest(app, { maxUploads: 2 });
        const { hold } = await sendPart(app, created, { "X-Reserve-Next": "1" });
        const withHold = { ...created.headers.upload, "X-Slot-Hold": hold! };
        const opened = await init(app, created.id, withHold, 10);
        const { id: uid } = (await opened.json()) as { id: string };
        await app.request(`/api/request/${created.id}/upload/${uid}`, { method: "DELETE" });
        expect(requestRow(created.id).reservedUploads).toBe(2);
        await sendPart(app, created, { "X-Slot-Hold": hold! });
        expect(requestRow(created.id)).toMatchObject({ reservedUploads: 2, finishedUploads: 2 });
      });

      it("gives both slots back when the first part is cancelled", async () => {
        const app = createApp();
        const created = await createRequest(app, { maxUploads: 2 });
        const both = { ...created.headers.upload, "X-Reserve-Next": "1" };
        const opened = await init(app, created.id, both, 10);
        const { id: uid } = (await opened.json()) as { id: string };
        expect(requestRow(created.id).reservedUploads).toBe(2);
        await app.request(`/api/request/${created.id}/upload/${uid}`, { method: "DELETE" });
        expect(requestRow(created.id).reservedUploads).toBe(0);
      });

      it("refuses a malformed hold or reservation header", async () => {
        const app = createApp();
        const created = await createRequest(app);
        for (const extra of [{ "X-Slot-Hold": "short" }, { "X-Reserve-Next": "2" }]) {
          const res = await init(app, created.id, { ...created.headers.upload, ...extra }, 10);
          expect(res.status).toBe(400);
        }
        expect(requestRow(created.id).reservedUploads).toBe(0);
      });
    });

    it("lets every upload take the size the request allows", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app, { maxSize: 100 });
      expect((await init(app, id, headers.upload, 100)).status).toBe(201);
      expect((await init(app, id, headers.upload, 101)).status).toBe(413);
      expect((await init(app, id, headers.upload, 100)).status).toBe(201);
      expect(requestRow(id).reservedUploads).toBe(2);
      const res = await app.request(`/api/request/${id}`, { headers: headers.upload });
      expect(await res.json()).toMatchObject({ uploadsLeft: 1, maxUploadSize: 100 });
    });

    it("refuses an upload larger than FILE_MAX_SIZE", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, FILE_MAX_SIZE: 50 });
      const app = createApp();
      const { id, headers } = await createRequest(app, { maxSize: 4096 });
      expect((await init(app, id, headers.upload, 51)).status).toBe(413);
      expect(requestRow(id).reservedUploads).toBe(0);
    });

    it("refuses uploads into a closed or expired request", async () => {
      const app = createApp();
      const closed = await createRequest(app);
      await app.request(`/api/inbox/${closed.id}/close`, {
        method: "POST",
        headers: closed.headers.owner,
      });
      expect((await init(app, closed.id, closed.headers.upload, 10)).status).toBe(410);

      const expired = await createRequest(app);
      dbCtx.db
        .update(fileRequests)
        .set({ closesAt: new Date(Date.now() - 1000) })
        .where(eq(fileRequests.id, expired.id))
        .run();
      expect((await init(app, expired.id, expired.headers.upload, 10)).status).toBe(410);
    });

    it("needs the upload token to open a session", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app);
      expect((await init(app, id, {}, 10)).status).toBe(404);
      expect((await init(app, id, headers.inbox, 10)).status).toBe(404);
      expect(requestRow(id).reservedUploads).toBe(0);
    });

    it("gives the slot back when the bytes do not match at finalize", async () => {
      const app = createApp();
      const created = await createRequest(app);
      const opened = await init(app, created.id, created.headers.upload, 100);
      const { id: uid } = (await opened.json()) as { id: string };
      await app.request(`/api/request/${created.id}/upload/${uid}/chunk?index=0`, {
        method: "POST",
        body: new Uint8Array(50),
      });
      const body = await finalizeBody(
        created.request.local.publicKey,
        created.id,
        uid,
        generateSecret(),
      );
      const res = await app.request(
        `/api/request/${created.id}/upload/${uid}/finalize`,
        json(body),
      );
      expect(res.status).toBe(400);
      expect(requestRow(created.id).reservedUploads).toBe(0);
    });

    it("keeps the session when the finalize body is broken", async () => {
      const app = createApp();
      const created = await createRequest(app);
      const opened = await init(app, created.id, created.headers.upload, 10);
      const { id: uid } = (await opened.json()) as { id: string };
      await app.request(`/api/request/${created.id}/upload/${uid}/chunk?index=0`, {
        method: "POST",
        body: new Uint8Array(10),
      });
      const finalize = `/api/request/${created.id}/upload/${uid}/finalize`;
      expect((await app.request(finalize, json({ wrapEnc: "x" }))).status).toBe(400);
      const body = await finalizeBody(
        created.request.local.publicKey,
        created.id,
        uid,
        generateSecret(),
      );
      expect((await app.request(finalize, json(body))).status).toBe(200);
    });

    it("keeps sessions of one request away from another", async () => {
      const app = createApp();
      const first = await createRequest(app);
      const second = await createRequest(app);
      const opened = await init(app, first.id, first.headers.upload, 10);
      const { id: uid } = (await opened.json()) as { id: string };
      const chunk = await app.request(`/api/request/${second.id}/upload/${uid}/chunk?index=0`, {
        method: "POST",
        body: new Uint8Array(10),
      });
      expect(chunk.status).toBe(404);
      const body = await finalizeBody(
        second.request.local.publicKey,
        second.id,
        uid,
        generateSecret(),
      );
      expect(
        (await app.request(`/api/request/${second.id}/upload/${uid}/finalize`, json(body))).status,
      ).toBe(404);
    });

    it("refuses a finalize after the request was deleted and drops the blob", async () => {
      const app = createApp();
      const created = await createRequest(app);
      const opened = await init(app, created.id, created.headers.upload, 10);
      const { id: uid } = (await opened.json()) as { id: string };
      await app.request(`/api/request/${created.id}/upload/${uid}/chunk?index=0`, {
        method: "POST",
        body: new Uint8Array(10),
      });
      await app.request(`/api/inbox/${created.id}`, {
        method: "DELETE",
        headers: created.headers.owner,
      });
      const body = await finalizeBody(
        created.request.local.publicKey,
        created.id,
        uid,
        generateSecret(),
      );
      expect(
        (await app.request(`/api/request/${created.id}/upload/${uid}/finalize`, json(body))).status,
      ).toBe(404);
      expect(await storage.exists(uid)).toBe(false);
    });

    it("gives reservations back at startup, since no session survives a restart", async () => {
      const app = createApp();
      const created = await createRequest(app, { maxUploads: 2 });
      await uploadInto(app, created, new Uint8Array(10));
      expect((await init(app, created.id, created.headers.upload, 30)).status).toBe(201);
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 2 });

      // A new route is what a restart creates.
      const restarted = createApp();
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 1 });
      expect((await init(restarted, created.id, created.headers.upload, 30)).status).toBe(201);
    });

    it("gives the slot back when a chunk fails", async () => {
      const app = createApp();
      const created = await createRequest(app);
      const opened = await init(app, created.id, created.headers.upload, 10);
      const { id: uid } = (await opened.json()) as { id: string };
      vi.spyOn(storage, "appendChunk").mockRejectedValueOnce(new Error("disk full"));
      const chunk = await app.request(`/api/request/${created.id}/upload/${uid}/chunk?index=0`, {
        method: "POST",
        body: new Uint8Array(10),
      });
      expect(chunk.status).toBe(500);
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 0 });
    });

    it("gives the slot back at once when the sender cancels", async () => {
      const app = createApp();
      const created = await createRequest(app, { maxUploads: 1 });
      const other = await createRequest(app);
      const opened = await init(app, created.id, created.headers.upload, 10);
      const { id: uid } = (await opened.json()) as { id: string };
      // Only the request the session belongs to can end it.
      expect(
        (await app.request(`/api/request/${other.id}/upload/${uid}`, { method: "DELETE" })).status,
      ).toBe(404);
      expect(
        (await app.request(`/api/request/${created.id}/upload/${uid}`, { method: "DELETE" }))
          .status,
      ).toBe(200);
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 0 });
      expect(
        (await app.request(`/api/request/${created.id}/upload/${uid}`, { method: "DELETE" }))
          .status,
      ).toBe(404);
      expect((await init(app, created.id, created.headers.upload, 10)).status).toBe(201);
    });

    it("lets a sender cancel even with the upload quota used up", async () => {
      let quotaUsedUp = false;
      const quotaApp = new Hono();
      quotaApp.route(
        "/api/request",
        createRequestRoute({
          storage,
          limiter,
          chunkDir: join(storageCtx.tempDir, "request-chunks"),
          quota: {
            middleware: async (c, next) => {
              if (quotaUsedUp)
                return c.json({ error: "Upload quota exceeded. Try again later." }, 429);
              await next();
            },
            recordUsage: () => {},
            check: () => ({ ok: true, hashedIp: null }),
          },
        }),
      );
      const { id, headers } = await createRequest(quotaApp);
      const opened = await init(quotaApp, id, headers.upload, 10);
      const { id: uid } = (await opened.json()) as { id: string };
      quotaUsedUp = true;
      expect(
        (await quotaApp.request(`/api/request/${id}/upload/${uid}`, { method: "DELETE" })).status,
      ).toBe(200);
      expect(requestRow(id).reservedUploads).toBe(0);
    });

    it("refuses an empty chunk", async () => {
      const app = createApp();
      const created = await createRequest(app);
      const opened = await init(app, created.id, created.headers.upload, 10);
      const { id: uid } = (await opened.json()) as { id: string };
      const chunk = await app.request(`/api/request/${created.id}/upload/${uid}/chunk?index=5`, {
        method: "POST",
        body: new Uint8Array(0),
      });
      expect(chunk.status).toBe(400);
    });

    it("counts the upload against the sender's quota", async () => {
      const quotaApp = new Hono();
      quotaApp.route(
        "/api/request",
        createRequestRoute({
          storage,
          limiter,
          chunkDir: join(storageCtx.tempDir, "request-chunks"),
          quota: {
            middleware: async (c) =>
              c.json({ error: "Upload quota exceeded. Try again later." }, 429),
            recordUsage: () => {},
          },
        }),
      );
      const { id, headers } = await createRequest(quotaApp);
      expect((await init(quotaApp, id, headers.upload, 10)).status).toBe(429);
      expect(requestRow(id).reservedUploads).toBe(0);
    });

    it("is not reachable through the routes of normal uploads", async () => {
      const app = createApp();
      const created = await createRequest(app);
      const uid = await uploadInto(app, created, new Uint8Array(10));
      expect((await app.request(`/api/info/${uid}`)).status).toBe(404);
      expect((await app.request(`/api/exists/${uid}`)).status).not.toBe(200);
      expect(
        (
          await app.request(`/api/download/${uid}`, {
            headers: { "X-Auth-Token": created.headers.inbox["X-Inbox-Token"] },
          })
        ).status,
      ).toBe(404);
    });
  });

  // ── The inbox ───────────────────────────────────────

  describe("inbox", () => {
    it("looks like a missing request without the right token", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app);
      expect((await app.request(`/api/inbox/${id}`)).status).toBe(404);
      expect(
        (
          await app.request(`/api/inbox/${id}`, {
            headers: { "X-Inbox-Token": headers.upload["X-Upload-Token"] },
          })
        ).status,
      ).toBe(404);
      expect(
        (await app.request(`/api/inbox/${crypto.randomUUID()}`, { headers: headers.inbox })).status,
      ).toBe(404);
    });

    it("locks a request with a password for an IP after too many wrong tokens", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app, { hasPassword: true });
      for (let i = 0; i < 3; i++) {
        await app.request(`/api/inbox/${id}`, {
          headers: { "X-Inbox-Token": fakeBase64urlToken() },
        });
      }
      const locked = await app.request(`/api/inbox/${id}`, { headers: headers.inbox });
      expect(locked.status).toBe(429);
      expect(locked.headers.get("Retry-After")).toBeTruthy();
      // Owner endpoints count against the same lock.
      expect(
        (await app.request(`/api/inbox/${id}`, { method: "DELETE", headers: headers.owner }))
          .status,
      ).toBe(429);
    });

    it("does not count a request without a well-formed token, which a foreign page can send", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app);
      for (let i = 0; i < 5; i++) {
        expect((await app.request(`/api/inbox/${id}`)).status).toBe(404);
        expect(
          (await app.request(`/api/inbox/${id}`, { headers: { "X-Inbox-Token": "junk" } })).status,
        ).toBe(404);
      }
      expect((await app.request(`/api/inbox/${id}`, { headers: headers.inbox })).status).toBe(200);
    });

    it("never locks a request without a password, whose tokens nobody can guess", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app);
      for (let i = 0; i < 5; i++) {
        await app.request(`/api/inbox/${id}`, {
          headers: { "X-Inbox-Token": fakeBase64urlToken() },
        });
      }
      expect((await app.request(`/api/inbox/${id}`, { headers: headers.inbox })).status).toBe(200);
    });

    it("never locks a request ID that does not exist", async () => {
      const app = createApp();
      const id = crypto.randomUUID();
      for (let i = 0; i < 5; i++) {
        expect(
          (
            await app.request(`/api/inbox/${id}`, {
              headers: { "X-Inbox-Token": fakeBase64urlToken() },
            })
          ).status,
        ).toBe(404);
      }
    });

    it("counts finished uploads as used, deleted ones included", async () => {
      const app = createApp();
      const created = await createRequest(app);
      const uid = await uploadInto(app, created, new Uint8Array(10));
      await app.request(`/api/inbox/${created.id}/file/${uid}`, {
        method: "DELETE",
        headers: created.headers.owner,
      });
      expect((await init(app, created.id, created.headers.upload, 5)).status).toBe(201);
      const inbox = (await (
        await app.request(`/api/inbox/${created.id}`, { headers: created.headers.inbox })
      ).json()) as Record<string, unknown>;
      expect(inbox).toMatchObject({ open: true, usedUploads: 1, usedBytes: 10, uploads: [] });
      expect(typeof inbox.createdAt).toBe("string");
    });

    it("keeps reading and managing apart", async () => {
      const app = createApp();
      const created = await createRequest(app);
      const uid = await uploadInto(app, created, new Uint8Array(10));
      const asReader = { "X-Inbox-Owner-Token": created.headers.inbox["X-Inbox-Token"] };
      expect(
        (await app.request(`/api/inbox/${created.id}/close`, { method: "POST", headers: asReader }))
          .status,
      ).toBe(404);
      expect(
        (
          await app.request(`/api/inbox/${created.id}/file/${uid}`, {
            method: "DELETE",
            headers: asReader,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await app.request(`/api/inbox/${created.id}`, {
            headers: { "X-Inbox-Token": created.headers.owner["X-Inbox-Owner-Token"] },
          })
        ).status,
      ).toBe(404);
    });

    it("deletes one upload but keeps its slot used", async () => {
      const app = createApp();
      const created = await createRequest(app, { maxUploads: 1 });
      const uid = await uploadInto(app, created, new Uint8Array(10));
      const res = await app.request(`/api/inbox/${created.id}/file/${uid}`, {
        method: "DELETE",
        headers: created.headers.owner,
      });
      expect(res.status).toBe(200);
      expect(await storage.exists(uid)).toBe(false);
      expect(dbCtx.db.select().from(requestUploads).all()).toHaveLength(0);
      expect((await init(app, created.id, created.headers.upload, 10)).status).toBe(409);
    });

    it("never touches an upload of another request", async () => {
      const app = createApp();
      const first = await createRequest(app);
      const second = await createRequest(app);
      const uid = await uploadInto(app, first, new Uint8Array(10));
      expect(
        (
          await app.request(`/api/inbox/${second.id}/file/${uid}`, {
            headers: second.headers.inbox,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await app.request(`/api/inbox/${second.id}/file/${uid}`, {
            method: "DELETE",
            headers: second.headers.owner,
          })
        ).status,
      ).toBe(404);
      expect(await storage.exists(uid)).toBe(true);
    });

    it("deletes the request with every upload in it", async () => {
      const app = createApp();
      const created = await createRequest(app);
      const uids = [
        await uploadInto(app, created, new Uint8Array(10)),
        await uploadInto(app, created, new Uint8Array(20)),
      ];
      const res = await app.request(`/api/inbox/${created.id}`, {
        method: "DELETE",
        headers: created.headers.owner,
      });
      expect(res.status).toBe(200);
      for (const uid of uids) expect(await storage.exists(uid)).toBe(false);
      expect(dbCtx.db.select().from(fileRequests).all()).toHaveLength(0);
      expect(dbCtx.db.select().from(requestUploads).all()).toHaveLength(0);
    });
  });

  // ── Cleanup ─────────────────────────────────────────

  describe("cleanup", () => {
    it("removes expired request uploads and requests that are over and empty", async () => {
      const app = createApp();
      const kept = await createRequest(app);
      const keptUpload = await uploadInto(app, kept, new Uint8Array(10));
      const expired = await createRequest(app);
      const expiredUpload = await uploadInto(app, expired, new Uint8Array(10));
      const empty = await createRequest(app);
      const recent = await createRequest(app);

      const past = (ms: number) => new Date(Date.now() - ms);
      dbCtx.db
        .update(requestUploads)
        .set({ expiresAt: past(1000) })
        .where(eq(requestUploads.id, expiredUpload))
        .run();
      // Over for two hours, so past the grace for running sessions.
      for (const id of [kept.id, expired.id, empty.id]) {
        dbCtx.db
          .update(fileRequests)
          .set({ closesAt: past(2 * 3600_000) })
          .where(eq(fileRequests.id, id))
          .run();
      }
      // Over for a minute only, a session may still finish.
      dbCtx.db
        .update(fileRequests)
        .set({ closesAt: past(60_000) })
        .where(eq(fileRequests.id, recent.id))
        .run();

      expect(await runCleanup(storage)).toBe(3);
      expect(await storage.exists(expiredUpload)).toBe(false);
      expect(await storage.exists(keptUpload)).toBe(true);
      const left = dbCtx.db
        .select({ id: fileRequests.id })
        .from(fileRequests)
        .all()
        .map((r) => r.id)
        .sort();
      expect(left).toEqual([kept.id, recent.id].sort());
    });
  });

  // ── WebSocket uploads into a request ───────────────

  describe("websocket uploads", () => {
    /** Opens the WebSocket of a request the way a browser would and returns its handlers. */
    async function connect(app: Hono, id: string, mock: ReturnType<typeof createMockUpgrade>) {
      await app.request(`/api/request/${id}/upload/ws`);
      return mock.getEvents() as WSEvents;
    }

    function wsInit(token: string, size: number) {
      return JSON.stringify({
        type: "init",
        request: {
          uploadToken: token,
          salt: toBase64url(generateSalt()),
          contentLength: size,
          fileCount: 1,
        },
      });
    }

    async function wsFinalize(
      publicKey: Uint8Array,
      requestId: string,
      uploadId: string,
      secret: Uint8Array,
    ) {
      return JSON.stringify({
        type: "finalize",
        ...(await finalizeBody(publicKey, requestId, uploadId, secret)),
      });
    }

    it("uploads into a request the same way as a normal upload and the requester unwraps it", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade, quota: true });
      const created = await createRequest(app);
      const events = await connect(app, created.id, mock);
      const fake = createFakeWs();
      const data = crypto.getRandomValues(new Uint8Array(64));
      const secret = generateSecret();

      await events.onMessage!(
        msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 64)),
        fake.ws,
      );
      const ready = fake.allJson().find((m) => m.type === "ready") as { id: string };
      expect(ready.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(requestRow(created.id).reservedUploads).toBe(1);

      await events.onMessage!(msgEvent(data.buffer), fake.ws);
      await events.onMessage!(
        msgEvent(await wsFinalize(created.request.local.publicKey, created.id, ready.id, secret)),
        fake.ws,
      );
      expect(fake.lastJson()).toMatchObject({ type: "done", id: ready.id });
      expect(fake.closed).toMatchObject({ code: 1000 });
      expect(requestRow(created.id)).toMatchObject({
        reservedUploads: 1,
        finishedUploads: 1,
        finishedBytes: 64,
      });
      expect(recorded).toEqual([["hashed-ip", 64]]);

      const row = dbCtx.db
        .select()
        .from(requestUploads)
        .where(eq(requestUploads.id, ready.id))
        .get()!;
      const { inboxKey } = await deriveInboxKeys(created.request.local.inboxSecret);
      const key = await openRequestKey(
        created.request.server.vault,
        created.request.server.vaultNonce,
        inboxKey,
        created.request.server.brief,
      );
      const unwrapped = await unwrapFileSecret(key, created.id, ready.id, {
        enc: new Uint8Array(row.wrapEnc),
        ciphertext: new Uint8Array(row.wrapCiphertext),
      });
      expect(unwrapped).toEqual(secret);

      const file = await app.request(`/api/inbox/${created.id}/file/${ready.id}`, {
        headers: created.headers.inbox,
      });
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(data);
    });

    it("stores an upload with the downloads of its request", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade });
      const created = await createRequest(app, { downloads: 2 });
      const events = await connect(app, created.id, mock);
      const fake = createFakeWs();
      await events.onMessage!(
        msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 8)),
        fake.ws,
      );
      const ready = fake.allJson().find((m) => m.type === "ready") as { id: string };
      await events.onMessage!(msgEvent(new Uint8Array(8).buffer), fake.ws);
      await events.onMessage!(
        msgEvent(
          await wsFinalize(created.request.local.publicKey, created.id, ready.id, generateSecret()),
        ),
        fake.ws,
      );
      const row = dbCtx.db
        .select()
        .from(requestUploads)
        .where(eq(requestUploads.id, ready.id))
        .get()!;
      expect(row.maxDownloads).toBe(2);
    });

    it("holds the second slot of a submission and hands it over in the done frame", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade });
      const created = await createRequest(app, { maxUploads: 2 });
      const token = created.headers.upload["X-Upload-Token"];
      const send = async (extra: Record<string, unknown>) => {
        const events = await connect(app, created.id, mock);
        const fake = createFakeWs();
        const frame = JSON.parse(wsInit(token, 8)) as { request: Record<string, unknown> };
        Object.assign(frame.request, extra);
        await events.onMessage!(msgEvent(JSON.stringify(frame)), fake.ws);
        const ready = fake.allJson().find((m) => m.type === "ready") as { id: string };
        await events.onMessage!(msgEvent(new Uint8Array(8).buffer), fake.ws);
        await events.onMessage!(
          msgEvent(
            await wsFinalize(
              created.request.local.publicKey,
              created.id,
              ready.id,
              generateSecret(),
            ),
          ),
          fake.ws,
        );
        return fake.lastJson() as { type: string; hold?: string };
      };

      const files = await send({ reserveNext: true });
      expect(files).toMatchObject({ type: "done", hold: expect.stringMatching(/^[\w-]{22}$/) });
      expect(requestRow(created.id).reservedUploads).toBe(2);
      const note = await send({ hold: files.hold });
      expect(note.type).toBe("done");
      expect(note.hold).toBeUndefined();
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 2, finishedUploads: 2 });
    });

    it("refuses a wrong upload token like the HTTP init and reserves nothing", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade });
      const created = await createRequest(app);
      const events = await connect(app, created.id, mock);
      const fake = createFakeWs();
      await events.onMessage!(msgEvent(wsInit(fakeBase64urlToken(), 10)), fake.ws);
      expect(fake.lastJson()).toMatchObject({ type: "error", status: 404 });
      expect(requestRow(created.id).reservedUploads).toBe(0);
    });

    it("names a full request with the status of the HTTP init", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade });
      const created = await createRequest(app, { maxUploads: 1 });
      expect((await init(app, created.id, created.headers.upload, 10)).status).toBe(201);
      const events = await connect(app, created.id, mock);
      const fake = createFakeWs();
      await events.onMessage!(
        msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 10)),
        fake.ws,
      );
      expect(fake.lastJson()).toMatchObject({
        type: "error",
        message: "File request is full",
        status: 409,
      });
    });

    it("checks the sender's quota before it reserves", async () => {
      const mock = createMockUpgrade();
      const app = createApp({
        upgradeWebSocket: mock.upgrade,
        quota: true,
        quotaRefusal: "Upload quota exceeded. Try again later.",
      });
      const created = await createRequest(app);
      const events = await connect(app, created.id, mock);
      const fake = createFakeWs();
      await events.onMessage!(
        msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 10)),
        fake.ws,
      );
      expect(fake.lastJson()).toMatchObject({ type: "error", status: 429 });
      expect(requestRow(created.id).reservedUploads).toBe(0);
    });

    it("gives the slot back when the socket closes before finalize", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade });
      const created = await createRequest(app);
      const events = await connect(app, created.id, mock);
      const fake = createFakeWs();
      await events.onMessage!(
        msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 10)),
        fake.ws,
      );
      expect(requestRow(created.id).reservedUploads).toBe(1);
      await events.onClose!(new CloseEvent("close"), fake.ws);
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 0 });
    });

    it("refuses a broken finalize, drops the blob and gives the slot back", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade });
      const created = await createRequest(app);
      const events = await connect(app, created.id, mock);
      const fake = createFakeWs();
      await events.onMessage!(
        msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 10)),
        fake.ws,
      );
      const ready = fake.allJson().find((m) => m.type === "ready") as { id: string };
      await events.onMessage!(msgEvent(new Uint8Array(10).buffer), fake.ws);
      await events.onMessage!(
        msgEvent(JSON.stringify({ type: "finalize", wrapEnc: "x" })),
        fake.ws,
      );
      expect(fake.lastJson()).toMatchObject({ type: "error", status: 400 });
      expect(await storage.exists(ready.id)).toBe(false);
      expect(requestRow(created.id).reservedUploads).toBe(0);
      expect(dbCtx.db.select().from(requestUploads).all()).toHaveLength(0);
    });

    it("refuses a finalize after the request was deleted and drops the blob", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade });
      const created = await createRequest(app);
      const events = await connect(app, created.id, mock);
      const fake = createFakeWs();
      await events.onMessage!(
        msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 10)),
        fake.ws,
      );
      const ready = fake.allJson().find((m) => m.type === "ready") as { id: string };
      await events.onMessage!(msgEvent(new Uint8Array(10).buffer), fake.ws);
      await app.request(`/api/inbox/${created.id}`, {
        method: "DELETE",
        headers: created.headers.owner,
      });
      await events.onMessage!(
        msgEvent(
          await wsFinalize(created.request.local.publicKey, created.id, ready.id, generateSecret()),
        ),
        fake.ws,
      );
      expect(fake.lastJson()).toMatchObject({ type: "error", status: 404 });
      expect(await storage.exists(ready.id)).toBe(false);
    });

    /** Blobs in storage, finished or not. */
    function blobs() {
      return readdirSync(storageCtx.tempDir).filter((name) => name.endsWith(".bin"));
    }

    it("never stores an upload whose slot it gave back when the socket closes during finalize", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade });
      const created = await createRequest(app, { maxUploads: 1 });
      const events = await connect(app, created.id, mock);
      const fake = createFakeWs();
      await events.onMessage!(
        msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 10)),
        fake.ws,
      );
      const ready = fake.allJson().find((m) => m.type === "ready") as { id: string };
      await events.onMessage!(msgEvent(new Uint8Array(10).buffer), fake.ws);
      const finalize = await wsFinalize(
        created.request.local.publicKey,
        created.id,
        ready.id,
        generateSecret(),
      );

      // The close lands while finalize writes the last bytes to storage.
      const append = storage.appendChunk.bind(storage);
      vi.spyOn(storage, "appendChunk").mockImplementationOnce(async (id, stream) => {
        await events.onClose!(new CloseEvent("close"), fake.ws);
        return append(id, stream);
      });
      await events.onMessage!(msgEvent(finalize), fake.ws);

      expect(dbCtx.db.select().from(requestUploads).all()).toHaveLength(0);
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 0, finishedUploads: 0 });
      expect(blobs()).toHaveLength(0);
    });

    it("gives the claim back when the socket closes while the init is checked", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade });
      const created = await createRequest(app);
      const events = await connect(app, created.id, mock);
      const fake = createFakeWs();
      const opening = events.onMessage!(
        msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 4000)),
        fake.ws,
      );
      await events.onClose!(new CloseEvent("close"), fake.ws);
      await opening;
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 0 });
      expect(blobs()).toHaveLength(0);
    });

    it("refuses a second init on the same socket and leaves nothing behind", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade });
      const created = await createRequest(app);
      const events = await connect(app, created.id, mock);
      const fake = createFakeWs();
      const token = created.headers.upload["X-Upload-Token"];
      const first = events.onMessage!(msgEvent(wsInit(token, 10)), fake.ws);
      const second = events.onMessage!(msgEvent(wsInit(token, 10)), fake.ws);
      await Promise.all([first, second]);
      await events.onClose!(new CloseEvent("close"), fake.ws);
      expect(fake.allJson()).toContainEqual({
        type: "error",
        message: "Unexpected message before ready",
      });
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 0 });
      expect(blobs()).toHaveLength(0);
    });

    it("ends a session that sends nothing for ten minutes and gives its slot back", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
      try {
        const mock = createMockUpgrade();
        const app = createApp({ upgradeWebSocket: mock.upgrade });
        const created = await createRequest(app);
        const events = await connect(app, created.id, mock);
        const fake = createFakeWs();
        await events.onMessage!(
          msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 10)),
          fake.ws,
        );
        expect(requestRow(created.id).reservedUploads).toBe(1);
        await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
        expect(fake.lastJson()).toMatchObject({ type: "error", message: "Upload timed out" });
        expect(requestRow(created.id).reservedUploads).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("ends a session that only trickles bytes and gives its slot back", async () => {
      vi.useFakeTimers({
        toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
      });
      try {
        const mock = createMockUpgrade();
        const app = createApp({ upgradeWebSocket: mock.upgrade });
        const created = await createRequest(app);
        const events = await connect(app, created.id, mock);
        const fake = createFakeWs();
        await events.onMessage!(
          msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 4096)),
          fake.ws,
        );
        // A byte every nine minutes never lets ten minutes pass in silence.
        for (let minute = 0; minute < 27; minute += 9) {
          await events.onMessage!(msgEvent(new Uint8Array(1).buffer), fake.ws);
          await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
        }
        expect(fake.lastJson()).toMatchObject({ type: "error", message: "Upload timed out" });
        expect(requestRow(created.id).reservedUploads).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps a slow upload that makes progress, and ends one that never finalizes", async () => {
      const MiB = 1024 * 1024;
      vi.mocked(getConfig).mockReturnValue({
        ...DEFAULT_CONFIG,
        FILE_MAX_SIZE: 8 * MiB,
        FILE_REQUEST_MAX_SIZE: 8 * MiB,
      } as unknown as ReturnType<typeof getConfig>);
      vi.useFakeTimers({
        toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
      });
      try {
        const mock = createMockUpgrade();
        const app = createApp({ upgradeWebSocket: mock.upgrade });
        const created = await createRequest(app, { maxSize: 8 * MiB });
        const events = await connect(app, created.id, mock);
        const fake = createFakeWs();
        await events.onMessage!(
          msgEvent(wsInit(created.headers.upload["X-Upload-Token"], 3 * MiB)),
          fake.ws,
        );
        // One MiB every nine minutes is enough to stay.
        for (let i = 0; i < 3; i++) {
          await events.onMessage!(msgEvent(new Uint8Array(MiB).buffer), fake.ws);
          await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
        }
        expect(fake.allJson().some((m) => m.type === "error")).toBe(false);
        expect(requestRow(created.id).reservedUploads).toBe(1);

        // Every byte is in, but no finalize follows.
        await vi.advanceTimersByTimeAsync(12 * 60 * 1000);
        expect(fake.lastJson()).toMatchObject({ type: "error", message: "Upload timed out" });
        expect(requestRow(created.id).reservedUploads).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("is off with the service, and absent without FILE_UPLOAD_WS", async () => {
      const mock = createMockUpgrade();
      const app = createApp({ upgradeWebSocket: mock.upgrade });
      const created = await createRequest(app);
      vi.mocked(getConfig).mockReturnValue({
        ...DEFAULT_CONFIG,
        ENABLED_SERVICES: ["file", "note"],
      });
      expect((await app.request(`/api/request/${created.id}/upload/ws`)).status).toBe(403);
      vi.mocked(getConfig).mockReturnValue(DEFAULT_CONFIG);
      const withoutWs = createApp();
      expect((await withoutWs.request(`/api/request/${created.id}/upload/ws`)).status).toBe(404);
    });
  });

  it("puts request chunks in their own folder", () => {
    createApp();
    expect(existsSync(join(storageCtx.tempDir, "request-chunks"))).toBe(true);
  });
});

describe("createRequestLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts each identity on its own for one day", () => {
    vi.useFakeTimers();
    const limiter = createRequestLimiter(2);
    expect(limiter.take("ip:1")).toBe(true);
    expect(limiter.take("ip:1")).toBe(true);
    expect(limiter.take("ip:1")).toBe(false);
    expect(limiter.take("ip:2")).toBe(true);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(limiter.take("ip:1")).toBe(true);
  });

  it("is unlimited at 0", () => {
    const limiter = createRequestLimiter(0);
    for (let i = 0; i < 100; i++) expect(limiter.take("ip:1")).toBe(true);
    expect(limiter.peek("ip:1")).toBeNull();
  });

  it("tells what is left without counting, and when the day ends", () => {
    vi.useFakeTimers();
    const limiter = createRequestLimiter(2);
    expect(limiter.peek("ip:1")).toEqual({ remaining: 2, resetsAt: null });
    limiter.take("ip:1");
    expect(limiter.peek("ip:1")).toEqual({ remaining: 1, resetsAt: Date.now() + 86_400_000 });
    limiter.take("ip:1");
    limiter.take("ip:1");
    expect(limiter.peek("ip:1")?.remaining).toBe(0);
    vi.advanceTimersByTime(86_400_000);
    expect(limiter.peek("ip:1")).toEqual({ remaining: 2, resetsAt: null });
  });
});
