import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { createApiClient, type ApiClient } from "@skysend/transfer";
import { createTestDb, createTestStorage, fakeBase64urlToken } from "./helpers.js";
import type { Config } from "../src/lib/config.js";

// The web app, the CLI and later the mobile app read every answer of the server with the Zod
// schemas of @skysend/transfer. These tests run the real routes and read their answers with the
// shared client, so a server change that the clients would no longer read fails here, not in
// front of a user.

vi.mock("../src/db/index.js", () => ({ getDb: vi.fn(), initDatabase: vi.fn() }));
vi.mock("../src/lib/config.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/lib/config.js")>()),
  getConfig: vi.fn(),
}));

import { getDb } from "../src/db/index.js";
import { getConfig, loadConfig } from "../src/lib/config.js";
import { configRoute } from "../src/routes/config.js";
import { createUploadRoute } from "../src/routes/upload.js";
import { createDeleteRoute } from "../src/routes/delete.js";
import { metaRoute } from "../src/routes/meta.js";
import { infoRoute } from "../src/routes/info.js";
import { createPasswordRoute } from "../src/routes/password.js";
import { createDownloadRoute } from "../src/routes/download.js";
import { createNoteRoute } from "../src/routes/note.js";
import { createPasswordLockout } from "../src/lib/password-lockout.js";

const bytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const b64url = (data: Uint8Array) => Buffer.from(data).toString("base64url");
const b64 = (data: Uint8Array) => Buffer.from(data).toString("base64");

describe("the API as the shared client reads it", () => {
  let dbCtx: ReturnType<typeof createTestDb>;
  let storageCtx: Awaited<ReturnType<typeof createTestStorage>>;
  let api: ApiClient;

  beforeEach(async () => {
    dbCtx = createTestDb();
    storageCtx = await createTestStorage();
    vi.mocked(getDb).mockReturnValue(dbCtx.db);
    // The configuration a server starts with when nothing is set, so every field is real.
    vi.stubEnv("DATA_DIR", storageCtx.tempDir);
    vi.stubEnv("BASE_URL", "http://localhost:3000");
    vi.mocked(getConfig).mockReturnValue(loadConfig() as Config);

    const lockout = createPasswordLockout(10, 60_000);
    const storage = storageCtx.storage;
    const app = new Hono();
    app.route("/api/config", configRoute);
    app.route(
      "/api/upload",
      createUploadRoute(storage, { chunkDir: join(storageCtx.tempDir, "chunks") }),
    );
    app.route("/api/upload", createDeleteRoute(storage));
    app.route("/api/meta", metaRoute);
    app.route("/api/info", infoRoute);
    app.route("/api/password", createPasswordRoute(lockout));
    app.route("/api/download", createDownloadRoute(storage, lockout));
    app.route("/api/note", createNoteRoute(lockout));
    api = createApiClient({
      baseUrl: "http://localhost",
      fetch: (input, init) => Promise.resolve(app.request(input as string, init)),
    });
  });

  afterEach(() => {
    dbCtx.cleanup();
    storageCtx.cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads the config of a server with nothing set", async () => {
    const config = await api.fetchConfig();
    expect(config.enabledServices).toEqual(["file", "note"]);
    expect(config.noteBlocks).toBe(true);
  });

  it("reads every step of a chunked upload, its info and its download", async () => {
    const ciphertext = bytes(4096);
    const authToken = b64url(bytes(32));
    const ownerToken = b64url(bytes(32));
    const id = await api.uploadInit({
      "X-Auth-Token": authToken,
      "X-Owner-Token": ownerToken,
      "X-Salt": b64url(bytes(32)),
      "X-Max-Downloads": "2",
      "X-Expire-Sec": "86400",
      "X-File-Count": "1",
      "X-Has-Password": "false",
      "X-Content-Length": String(ciphertext.length),
    });
    await api.uploadChunk(id, 0, ciphertext);
    expect(await api.uploadFinalize(id, { headers: { "X-Owner-Token": ownerToken } })).toEqual({
      hold: undefined,
    });
    await api.saveMeta(id, ownerToken, b64(bytes(64)), b64(bytes(12)));

    const info = await api.fetchInfo(id);
    expect(info).toMatchObject({ id, size: ciphertext.length, hasPassword: false });
    expect(info.encryptedMeta).not.toBeNull();

    const download = await api.downloadFile(id, authToken);
    expect(download.storageBackend).toBe("filesystem");
    expect(new Uint8Array(await new Response(download.stream).arrayBuffer())).toEqual(ciphertext);

    await api.deleteUpload(id, ownerToken);
    await expect(api.fetchInfo(id)).rejects.toMatchObject({ status: 404 });
  });

  it("reads a password check the way a recipient sends it", async () => {
    const ownerToken = b64url(bytes(32));
    const id = await api.uploadInit({
      "X-Auth-Token": b64url(bytes(32)),
      "X-Owner-Token": ownerToken,
      "X-Salt": b64url(bytes(32)),
      "X-Max-Downloads": "1",
      "X-Expire-Sec": "86400",
      "X-File-Count": "1",
      "X-Has-Password": "true",
      "X-Password-Salt": b64url(bytes(16)),
      "X-Password-Algo": "argon2id-v2",
      "X-Content-Length": "100",
    });
    await api.uploadChunk(id, 0, bytes(100));
    await api.uploadFinalize(id, { headers: { "X-Owner-Token": ownerToken } });

    expect((await api.fetchInfo(id)).passwordAlgo).toBe("argon2id-v2");
    expect(await api.verifyPassword(id, fakeBase64urlToken())).toBeNull();
  });

  it("reads a note from its creation to its view", async () => {
    const authToken = b64url(bytes(32));
    const ownerToken = b64url(bytes(32));
    const { id } = await api.createNote({
      encryptedContent: b64(bytes(128)),
      nonce: b64(bytes(12)),
      salt: b64url(bytes(16)),
      ownerToken,
      authToken,
      contentType: "blocks",
      maxViews: 1,
      expireSec: 86400,
      hasPassword: false,
    });

    expect(await api.fetchNoteInfo(id)).toMatchObject({ id, contentType: "blocks" });
    expect(await api.viewNote(id, authToken)).toMatchObject({ viewCount: 1, maxViews: 1 });
  });
});
