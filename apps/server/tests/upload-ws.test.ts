import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { createTestDb, createTestStorage } from "./helpers.js";
import { createFakeWs, createMockUpgrade, msgEvent } from "./ws-helpers.js";
import { uploads } from "../src/db/schema.js";
import type { FileStorage } from "../src/storage/filesystem.js";

// Mocks - order matters (hoisted before the route import).
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
import { createUploadWsRoute } from "../src/routes/upload-ws.js";

const DEFAULT_CONFIG = {
  PORT: 3000,
  HOST: "0.0.0.0",
  BASE_URL: "http://localhost:3000",
  DATA_DIR: "./data",
  UPLOADS_DIR: "/tmp/uploads",
  FILE_MAX_SIZE: 2 * 1024 ** 3,
  FILE_EXPIRE_OPTIONS_SEC: [300, 3600, 86400, 604800],
  FILE_DEFAULT_EXPIRE_SEC: 86400,
  FILE_DOWNLOAD_OPTIONS: [1, 2, 3, 4, 5, 10, 20, 50, 100],
  FILE_DEFAULT_DOWNLOAD: 1,
  FILE_MAX_FILES_PER_UPLOAD: 32,
  FILE_UPLOAD_QUOTA_BYTES: 0,
  FILE_UPLOAD_QUOTA_WINDOW: 86400,
  FILE_UPLOAD_CONCURRENT_CHUNKS: 3,
  FILE_UPLOAD_SPEED_LIMIT: 0,
  FILE_UPLOAD_WS: true,
  FILE_UPLOAD_WS_MAX_BUFFER: 16 * 1024 * 1024,
  NOTE_MAX_SIZE: 1024 ** 2,
  NOTE_EXPIRE_OPTIONS_SEC: [300, 3600, 86400, 604800],
  NOTE_DEFAULT_EXPIRE_SEC: 86400,
  NOTE_VIEW_OPTIONS: [1, 2, 3, 5, 10, 20, 50, 100],
  NOTE_DEFAULT_VIEWS: 1,
  CLEANUP_INTERVAL: 60,
  CUSTOM_TITLE: "SkySend",
  CORS_ORIGINS: [],
  RATE_LIMIT_WINDOW: 60000,
  RATE_LIMIT_MAX: 60,
  TRUST_PROXY: false,
  ENABLED_SERVICES: ["file", "note"] as ("file" | "note")[],
  STORAGE_BACKEND: "filesystem" as const,
  S3_FORCE_PATH_STYLE: false,
  S3_PRESIGNED_EXPIRY: 300,
  S3_PART_SIZE: 25 * 1024 * 1024,
  S3_CONCURRENCY: 4,
};

/** Build a valid upload-init payload. */
function buildHeaders(overrides: Record<string, unknown> = {}) {
  const authToken = "a".repeat(43);
  const ownerToken = "b".repeat(43);
  // SALT_LENGTH = 32 bytes (updated in crypto package - legacy 16-byte salts are only
  // accepted for decryption of old uploads, new uploads must use 32 bytes).
  const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  return {
    authToken,
    ownerToken,
    salt,
    maxDownloads: "3",
    expireSec: "3600",
    fileCount: "1",
    contentLength: "64",
    hasPassword: "false",
    ...overrides,
  };
}

describe("upload-ws route", () => {
  let dbCtx: ReturnType<typeof createTestDb>;
  let storageCtx: Awaited<ReturnType<typeof createTestStorage>>;
  let storage: FileStorage;

  beforeEach(async () => {
    dbCtx = createTestDb();
    storageCtx = await createTestStorage();
    storage = storageCtx.storage;
    vi.mocked(getDb).mockReturnValue(dbCtx.db);
    vi.mocked(getConfig).mockReturnValue({
      ...DEFAULT_CONFIG,
      UPLOADS_DIR: storageCtx.tempDir,
    } as unknown as ReturnType<typeof getConfig>);
  });

  afterEach(() => {
    dbCtx.cleanup();
    storageCtx.cleanup();
    vi.restoreAllMocks();
  });

  async function bootstrap() {
    const mock = createMockUpgrade();
    const recordUsage = vi.fn();
    const route = createUploadWsRoute({
      storage,
      upgradeWebSocket: mock.upgrade,
      quota: {
        check: () => ({ ok: true, hashedIp: null }),
        record: recordUsage,
      },
    });
    // Trigger the middleware to install the event handlers.
    await route.request("/", {
      method: "GET",
      headers: { "X-Forwarded-For": "127.0.0.1" },
    });
    return { events: mock.getEvents(), recordUsage };
  }

  it("completes a happy-path upload", async () => {
    const { events } = await bootstrap();
    const fake = createFakeWs();
    const headers = buildHeaders({ contentLength: "64" });

    // 1) init
    await events.onMessage!(
      msgEvent(JSON.stringify({ type: "init", headers })),
      fake.ws,
    );
    const ready = fake.allJson().find((m) => m.type === "ready") ?? null;
    expect(ready).toMatchObject({ type: "ready" });
    const uploadId = (ready as { id: string }).id;
    expect(uploadId).toMatch(/^[0-9a-f-]{36}$/);

    // 2) send 64 bytes of payload
    const payload = new Uint8Array(64);
    crypto.getRandomValues(payload);
    await events.onMessage!(msgEvent(payload.buffer), fake.ws);

    // 3) finalize
    await events.onMessage!(
      msgEvent(JSON.stringify({ type: "finalize" })),
      fake.ws,
    );

    const doneFrames = fake.allJson().filter((m) => m.type === "done");
    expect(doneFrames).toHaveLength(1);
    expect(doneFrames[0]).toMatchObject({ type: "done", id: uploadId });
    expect(fake.closed).toMatchObject({ code: 1000 });

    // DB record
    const row = dbCtx.db.select().from(uploads).where(eq(uploads.id, uploadId)).get();
    expect(row).toBeTruthy();
    expect(row!.size).toBe(64);

    // File content matches
    const written = await readFile(storageCtx.tempDir + "/" + uploadId + ".bin");
    expect(new Uint8Array(written)).toEqual(payload);
  });

  it("answers a frame that is JSON but not an object instead of crashing", async () => {
    const { events } = await bootstrap();
    const fake = createFakeWs();
    await events.onMessage!(msgEvent("null"), fake.ws);
    expect(fake.lastJson()).toMatchObject({
      type: "error",
      message: "First message must be of type 'init'",
    });
  });

  it("leaves no file behind when the socket closes while the init is checked", async () => {
    const { events } = await bootstrap();
    const fake = createFakeWs();
    const opening = events.onMessage!(
      msgEvent(JSON.stringify({ type: "init", headers: buildHeaders() })),
      fake.ws,
    );
    await events.onClose!(new CloseEvent("close"), fake.ws);
    await opening;
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(storageCtx.tempDir).filter((name) => name.endsWith(".bin"))).toHaveLength(0);
  });

  it("stores nothing when the socket closes during finalize", async () => {
    const { events } = await bootstrap();
    const fake = createFakeWs();
    await events.onMessage!(
      msgEvent(JSON.stringify({ type: "init", headers: buildHeaders({ contentLength: "64" }) })),
      fake.ws,
    );
    await events.onMessage!(msgEvent(new Uint8Array(64).buffer), fake.ws);
    // The close lands while finalize writes the last bytes to storage.
    const append = storage.appendChunk.bind(storage);
    vi.spyOn(storage, "appendChunk").mockImplementationOnce(async (id, stream) => {
      await events.onClose!(new CloseEvent("close"), fake.ws);
      return append(id, stream);
    });
    await events.onMessage!(msgEvent(JSON.stringify({ type: "finalize" })), fake.ws);
    expect(dbCtx.db.select().from(uploads).all()).toHaveLength(0);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(storageCtx.tempDir).filter((name) => name.endsWith(".bin"))).toHaveLength(0);
  });

  it("rejects invalid init payload", async () => {
    const { events } = await bootstrap();
    const fake = createFakeWs();
    await events.onMessage!(
      msgEvent(JSON.stringify({ type: "notinit" })),
      fake.ws,
    );
    const err = fake.allJson().find((m) => m.type === "error");
    expect(err).toBeTruthy();
    expect(fake.closed?.code).toBeDefined();
  });

  it("rejects when bytes exceed contentLength", async () => {
    const { events } = await bootstrap();
    const fake = createFakeWs();
    await events.onMessage!(
      msgEvent(JSON.stringify({ type: "init", headers: buildHeaders({ contentLength: "10" }) })),
      fake.ws,
    );

    const tooBig = new Uint8Array(20);
    await events.onMessage!(msgEvent(tooBig.buffer), fake.ws);

    const err = fake.allJson().find((m) => m.type === "error");
    expect(err).toMatchObject({ type: "error" });
    expect(String((err as { message: string }).message)).toMatch(/more bytes/i);
  });

  it("rejects when finalize sees fewer bytes than declared", async () => {
    const { events } = await bootstrap();
    const fake = createFakeWs();
    await events.onMessage!(
      msgEvent(JSON.stringify({ type: "init", headers: buildHeaders({ contentLength: "64" }) })),
      fake.ws,
    );
    await events.onMessage!(msgEvent(new Uint8Array(32).buffer), fake.ws);
    await events.onMessage!(
      msgEvent(JSON.stringify({ type: "finalize" })),
      fake.ws,
    );
    const err = fake.allJson().find((m) => m.type === "error");
    expect(err).toMatchObject({ type: "error" });
    expect(String((err as { message: string }).message)).toMatch(/size/i);
  });

  it("rejects handshake when quota denies", async () => {
    const mock = createMockUpgrade();
    const route = createUploadWsRoute({
      storage,
      upgradeWebSocket: mock.upgrade,
      quota: {
        check: () => ({ ok: false, reason: "Upload quota exceeded. Try again later." }),
        record: vi.fn(),
      },
    });
    await route.request("/", { method: "GET" });
    const events = mock.getEvents();
    const fake = createFakeWs();
    await events.onMessage!(
      msgEvent(JSON.stringify({ type: "init", headers: buildHeaders() })),
      fake.ws,
    );
    const err = fake.allJson().find((m) => m.type === "error");
    expect(err).toMatchObject({ type: "error", message: "Upload quota exceeded. Try again later." });
  });

  it("sends keepalive messages during slow finalization", async () => {
    const { events } = await bootstrap();
    const fake = createFakeWs();
    const headers = buildHeaders({ contentLength: "16" });

    await events.onMessage!(
      msgEvent(JSON.stringify({ type: "init", headers })),
      fake.ws,
    );
    await events.onMessage!(msgEvent(new Uint8Array(16).buffer), fake.ws);

    // Delay finalizeChunkedUpload so the keepalive timer fires before done.
    let resolveFinalize!: () => void;
    vi.spyOn(storage, "finalizeChunkedUpload").mockReturnValueOnce(
      new Promise<void>((resolve) => { resolveFinalize = resolve; }),
    );

    // Switch to fake timers before finalize so setInterval uses them.
    vi.useFakeTimers();
    try {
      const finalizePromise = events.onMessage!(
        msgEvent(JSON.stringify({ type: "finalize" })),
        fake.ws,
      );

      // Advance past the 5 s keepalive interval.
      await vi.advanceTimersByTimeAsync(5_001);

      const keepalives = fake.allJson().filter((m) => m.type === "keepalive");
      expect(keepalives.length).toBeGreaterThanOrEqual(1);

      // Let finalization complete and verify done is sent.
      resolveFinalize();
      await finalizePromise;
    } finally {
      vi.useRealTimers();
    }

    const done = fake.allJson().find((m) => m.type === "done");
    expect(done).toBeTruthy();
  });

  it("records quota usage on successful finalize", async () => {
    const mock = createMockUpgrade();
    const recordUsage = vi.fn();
    const route = createUploadWsRoute({
      storage,
      upgradeWebSocket: mock.upgrade,
      quota: {
        check: () => ({ ok: true, hashedIp: "hashed-ip-1" }),
        record: recordUsage,
      },
    });
    await route.request("/", { method: "GET" });
    const events = mock.getEvents();
    const fake = createFakeWs();

    await events.onMessage!(
      msgEvent(JSON.stringify({ type: "init", headers: buildHeaders({ contentLength: "16" }) })),
      fake.ws,
    );
    await events.onMessage!(msgEvent(new Uint8Array(16).buffer), fake.ws);
    await events.onMessage!(
      msgEvent(JSON.stringify({ type: "finalize" })),
      fake.ws,
    );

    expect(recordUsage).toHaveBeenCalledWith("hashed-ip-1", 16);
  });
});
