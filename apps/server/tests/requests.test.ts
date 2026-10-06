import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
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

const DEFAULT_CONFIG = {
  FILE_MAX_SIZE: 1024 * 1024,
  FILE_MAX_FILES_PER_UPLOAD: 32,
  FILE_UPLOAD_CONCURRENT_CHUNKS: 3,
  FILE_UPLOAD_SPEED_LIMIT: 0,
  FILE_REQUEST_EXPIRE_OPTIONS_SEC: [86400, 259200, 604800],
  FILE_REQUEST_DEFAULT_EXPIRE_SEC: 259200,
  FILE_REQUEST_MAX_UPLOADS: 10,
  FILE_REQUEST_MAX_SIZE: 10 * 1024 * 1024,
  FILE_REQUEST_RETENTION_SEC: 604800,
  FILE_REQUEST_DOWNLOADS: 5,
  FILE_REQUEST_DAILY_LIMIT: 10,
  FORCE_FILE_PASSWORD: false,
  TRUST_PROXY: false,
  ENABLED_SERVICES: ["file", "note", "request"],
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
    title: server.title
      ? { ciphertext: toBase64url(server.title.ciphertext), nonce: toBase64url(server.title.nonce) }
      : null,
    expireSec: 86400,
    maxUploads: 3,
    maxSize: 4096,
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
  function createApp(options: { createGuard?: MiddlewareHandler; quota?: boolean } = {}) {
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
            }
          : undefined,
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
      expect(row.uploadToken).toBe(toBase64url(request.server.uploadToken));
      const stored = JSON.stringify(row);
      for (const secret of Object.values(request.local)) {
        expect(stored).not.toContain(toBase64url(secret));
      }
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

    it("rejects more uploads or bytes than the server allows", async () => {
      const app = createApp();
      const request = await createFileRequest();
      const tooMany = await app.request(
        "/api/request",
        json(createBody(request, { maxUploads: 11 })),
      );
      expect(tooMany.status).toBe(400);
      const tooLarge = await app.request(
        "/api/request",
        json(createBody(request, { maxSize: DEFAULT_CONFIG.FILE_REQUEST_MAX_SIZE + 1 })),
      );
      expect(tooLarge.status).toBe(400);
    });

    it("requires a password when FORCE_FILE_PASSWORD is set", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, FORCE_FILE_PASSWORD: true });
      const app = createApp();
      const request = await createFileRequest();
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
    it("returns the title and the space left", async () => {
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
      expect(body.title).toEqual({
        ciphertext: toBase64url(request.server.title!.ciphertext),
        nonce: toBase64url(request.server.title!.nonce),
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

    it("returns no title when the requester gave none", async () => {
      const app = createApp();
      const request = await createFileRequest();
      const res = await app.request("/api/request", json(createBody(request)));
      const { id } = (await res.json()) as { id: string };
      const view = await app.request(`/api/request/${id}`, {
        headers: { "X-Upload-Token": toBase64url(request.server.uploadToken) },
      });
      expect(((await view.json()) as { title: unknown }).title).toBeNull();
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

    it("counts downloads but never a listing", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, FILE_REQUEST_DOWNLOADS: 1 });
      const app = createApp();
      const created = await createRequest(app);
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

    it("refuses an upload larger than the space left", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app, { maxSize: 100 });
      expect((await init(app, id, headers.upload, 60)).status).toBe(201);
      expect((await init(app, id, headers.upload, 41)).status).toBe(413);
      expect((await init(app, id, headers.upload, 40)).status).toBe(201);
      expect(requestRow(id).reservedBytes).toBe(100);
    });

    it("refuses an upload larger than FILE_MAX_SIZE", async () => {
      vi.mocked(getConfig).mockReturnValue({ ...DEFAULT_CONFIG, FILE_MAX_SIZE: 50 });
      const app = createApp();
      const { id, headers } = await createRequest(app, { maxSize: 4096 });
      expect((await init(app, id, headers.upload, 51)).status).toBe(413);
      expect(requestRow(id).reservedBytes).toBe(0);
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
      const row = requestRow(created.id);
      expect(row.reservedUploads).toBe(0);
      expect(row.reservedBytes).toBe(0);
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
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 2, reservedBytes: 40 });

      // A new route is what a restart creates.
      const restarted = createApp();
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 1, reservedBytes: 10 });
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
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 0, reservedBytes: 0 });
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
      expect(requestRow(created.id)).toMatchObject({ reservedUploads: 0, reservedBytes: 0 });
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
              if (quotaUsedUp) return c.json({ error: "Upload quota exceeded. Try again later." }, 429);
              await next();
            },
            recordUsage: () => {},
          },
        }),
      );
      const { id, headers } = await createRequest(quotaApp);
      const opened = await init(quotaApp, id, headers.upload, 10);
      const { id: uid } = (await opened.json()) as { id: string };
      quotaUsedUp = true;
      expect((await quotaApp.request(`/api/request/${id}/upload/${uid}`, { method: "DELETE" })).status).toBe(200);
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

    it("locks the request for an IP after too many wrong tokens", async () => {
      const app = createApp();
      const { id, headers } = await createRequest(app);
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

    it("locks a request ID that does not exist the same way", async () => {
      const app = createApp();
      const id = crypto.randomUUID();
      for (let i = 0; i < 3; i++) {
        expect(
          (
            await app.request(`/api/inbox/${id}`, {
              headers: { "X-Inbox-Token": fakeBase64urlToken() },
            })
          ).status,
        ).toBe(404);
      }
      expect(
        (
          await app.request(`/api/inbox/${id}`, {
            headers: { "X-Inbox-Token": fakeBase64urlToken() },
          })
        ).status,
      ).toBe(429);
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
  });
});
