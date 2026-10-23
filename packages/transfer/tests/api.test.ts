import { describe, expect, it } from "vitest";
import { ApiError, createApiClient, holdOf, isUploadId, withUnlockedMeta } from "../src/api.js";

// The routes themselves are tested against the real server in apps/server/tests/api-contract.test.ts.
// Here: what the client sends where, which headers go along, and what it makes of each answer.

const ID = "11111111-2222-4333-8444-555555555555";
const HOLD = "AbCdEfGhIjKlMnOpQrStUv";

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** A fetch that records every request and answers with `answer`. */
function server(
  answer: (url: string, sent: Sent) => Response | Promise<Response> = () => json({ ok: true }),
) {
  const sent: Sent[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request: Sent = {
      url: String(input),
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body,
    };
    sent.push(request);
    return answer(request.url, request);
  }) as typeof globalThis.fetch;
  return { sent, fetch };
}

const config = {
  enabledServices: ["file", "note"],
  fileMaxSize: 1024,
  fileMaxFilesPerUpload: 10,
  fileExpireOptions: [3600],
  fileDefaultExpire: 3600,
  fileDownloadOptions: [1],
  fileDefaultDownload: 1,
  fileUploadQuotaBytes: 0,
  fileUploadQuotaWindow: 86400,
  fileUploadConcurrentChunks: 3,
  noteMaxSize: 1024,
  noteExpireOptions: [3600],
  noteDefaultExpire: 3600,
  noteViewOptions: [1],
  noteDefaultViews: 1,
  customTitle: "SkySend",
  customColor: null,
  customLogo: null,
  customPrivacy: null,
  customLegal: null,
  customLinkUrl: null,
  customLinkName: null,
  customReportUrl: null,
  defaultTheme: "light",
  defaultColorScheme: "system",
  defaultTab: "file",
};

const info = {
  id: ID,
  size: 10,
  fileCount: 1,
  hasPassword: true,
  salt: "c2FsdA",
  encryptedMeta: null,
  nonce: null,
  downloadCount: 0,
  maxDownloads: 1,
  expiresAt: "2099-01-01T00:00:00.000Z",
  createdAt: "2026-10-23T00:00:00.000Z",
};

describe("createApiClient", () => {
  it("builds every URL on the base without its trailing slashes, IDs encoded", async () => {
    const { sent, fetch } = server(() => json(info));
    const api = createApiClient({ baseUrl: "https://send.example.com///", fetch });
    expect(api.url("/api/config")).toBe("https://send.example.com/api/config");
    await api.fetchInfo("a/b?c");
    expect(sent[0]!.url).toBe("https://send.example.com/api/info/a%2Fb%3Fc");
  });

  it("sends the OIDC session only to the routes that create something", async () => {
    const { sent, fetch } = server((url) => {
      if (url.endsWith("/api/request/limit"))
        return json({ dailyLimit: 0, remaining: null, resetsAt: null });
      if (url.endsWith("/init")) return json({ id: ID });
      if (url.endsWith("/api/note")) return json({ id: "n", expiresAt: "x" });
      if (url.endsWith("/api/request")) return json({ id: ID, closesAt: "x" });
      if (url.includes("/api/info/")) return json(info);
      return json({ ok: true });
    });
    const api = createApiClient({
      baseUrl: "https://send.example.com",
      fetch,
      bearer: "session.jwt",
    });

    await api.fetchRequestLimit();
    await api.uploadInit({ "X-Upload-Size": "1" });
    await api.createNote({} as never);
    await api.createRequest({} as never);
    const guarded = sent.splice(0);
    expect(guarded.every((r) => r.headers.authorization === "Bearer session.jwt")).toBe(true);

    // A sender's upload into a request is guarded by its upload token, and reading by nothing.
    await api.uploadInit({}, { requestId: "r" });
    await api.fetchInfo(ID);
    await api.deleteUpload(ID, "owner");
    await api.closeRequest("r", "owner");
    expect(sent.some((r) => "authorization" in r.headers)).toBe(false);
  });

  it("throws the server's message as an ApiError, cleaned by the caller", async () => {
    const esc = String.fromCharCode(27);
    const { fetch } = server(() => json({ error: `${esc}]52;c;Y29weQ==${esc}\\Nope` }, 403));
    const api = createApiClient({
      baseUrl: "",
      fetch,
      cleanMessage: (message) => message.replaceAll(esc, "?"),
    });
    const error = await api.fetchQuota().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: "?]52;c;Y29weQ==?\\Nope" });
  });

  it("falls back to its own message where the server names none", async () => {
    const { fetch } = server(() => new Response("gateway", { status: 502 }));
    const api = createApiClient({ baseUrl: "", fetch });
    await expect(api.fetchConfig()).rejects.toMatchObject({
      status: 502,
      message: "Request failed (502)",
    });
    await expect(api.deleteUpload(ID, "owner")).rejects.toThrow("Delete failed");
    await expect(api.deleteNote(ID, "owner")).rejects.toThrow("Delete failed");
    await expect(api.saveMeta(ID, "owner", "m", "n")).rejects.toThrow("Failed to save metadata");
    await expect(api.createNote({} as never)).rejects.toThrow("Failed to create note");
  });

  it("reads the config of an older server with defaults for what it does not send", async () => {
    const { fetch } = server(() => json(config));
    const read = await createApiClient({ baseUrl: "", fetch }).fetchConfig();
    expect(read).toMatchObject({
      fileRequestsEnabled: false,
      noteBlocks: false,
      fileUploadWs: false,
      // A server before v3 sent a color scheme as its theme.
      defaultTheme: "graphite",
      oidcProtectNotes: false,
    });
  });

  it("refuses an answer that does not fit its schema", async () => {
    const { fetch } = server(() => json({ enabled: "yes" }));
    await expect(createApiClient({ baseUrl: "", fetch }).fetchQuota()).rejects.toThrow();
  });

  describe("password checks", () => {
    const check = (status: number, body: unknown = { ok: true }) =>
      createApiClient({ baseUrl: "", fetch: server(() => json(body, status)).fetch });

    it("answers null for a wrong password and the released metadata for a right one", async () => {
      expect(await check(401).verifyPassword(ID, "t")).toBeNull();
      expect(
        await check(200, { ok: true, encryptedMeta: "m", nonce: "n" }).verifyPassword(ID, "t"),
      ).toEqual({
        encryptedMeta: "m",
        nonce: "n",
      });
      // A server before GHSA-rxxj-c5wr-phqp keeps the metadata in the info.
      expect(await check(200).verifyPassword(ID, "t")).toEqual({
        encryptedMeta: null,
        nonce: null,
      });
    });

    it("tells a lockout and a failure apart from a wrong password", async () => {
      await expect(check(429).verifyPassword(ID, "t")).rejects.toMatchObject({
        status: 429,
        message: "rate-limited",
      });
      await expect(check(500).verifyNotePassword(ID, "t")).rejects.toThrow(
        "Password verification failed",
      );
      expect(await check(401).verifyNotePassword(ID, "t")).toBe(false);
      expect(await check(200).verifyNotePassword(ID, "t")).toBe(true);
    });

    it("sends the token in the body, never in the URL", async () => {
      const { sent, fetch } = server();
      await createApiClient({ baseUrl: "", fetch }).verifyNotePassword(ID, "the.token");
      expect(sent[0]).toMatchObject({
        url: `/api/note/${ID}/password`,
        method: "POST",
        body: '{"authToken":"the.token"}',
      });
    });
  });

  describe("downloads", () => {
    it("streams the ciphertext of the filesystem backend with its size and file count", async () => {
      const { sent, fetch } = server(
        () =>
          new Response("ciphertext", { headers: { "Content-Length": "10", "X-File-Count": "3" } }),
      );
      const got = await createApiClient({ baseUrl: "", fetch }).downloadFile(ID, "auth");
      expect(sent[0]!.headers["x-auth-token"]).toBe("auth");
      expect(got).toMatchObject({ size: 10, fileCount: 3, storageBackend: "filesystem" });
      expect(await new Response(got.stream).text()).toBe("ciphertext");
    });

    it("follows the presigned URL of the S3 backend", async () => {
      const { sent, fetch } = server((url) =>
        url.startsWith("https://bucket")
          ? new Response("from the bucket")
          : json({ url: "https://bucket.example/obj?sig=1", size: 15, fileCount: 1 }),
      );
      const got = await createApiClient({ baseUrl: "", fetch }).downloadInboxFile("r", ID, "inbox");
      expect(sent.map((r) => r.url)).toEqual([
        `/api/inbox/r/file/${ID}`,
        "https://bucket.example/obj?sig=1",
      ]);
      expect(sent[0]!.headers["x-inbox-token"]).toBe("inbox");
      // The bucket gets no token of the server.
      expect(sent[1]!.headers).toEqual({});
      expect(got).toMatchObject({ size: 15, storageBackend: "s3" });
      expect(await new Response(got.stream).text()).toBe("from the bucket");
    });

    it("names CORS when the bucket cannot be reached and passes on what it answers", async () => {
      const presigned = json({ url: "https://bucket.example/obj", size: 1, fileCount: 1 });
      const unreachable = server((url) => {
        if (url.startsWith("https://bucket")) throw new TypeError("Failed to fetch");
        return presigned.clone();
      });
      await expect(
        createApiClient({ baseUrl: "", fetch: unreachable.fetch }).downloadFile(ID, "a"),
      ).rejects.toThrow("S3 CORS error");
      const refused = server((url) =>
        url.startsWith("https://bucket") ? new Response("", { status: 403 }) : presigned.clone(),
      );
      await expect(
        createApiClient({ baseUrl: "", fetch: refused.fetch }).downloadFile(ID, "a"),
      ).rejects.toMatchObject({
        status: 403,
        message: "S3 download failed",
      });
    });

    it("throws the server's error for a download it refuses", async () => {
      const { fetch } = server(() => json({ error: "Download limit reached" }, 410));
      await expect(
        createApiClient({ baseUrl: "", fetch }).downloadFile(ID, "a"),
      ).rejects.toMatchObject({
        status: 410,
        message: "Download limit reached",
      });
    });
  });

  describe("chunked uploads", () => {
    it("opens, sends and commits an upload into a request under its own path", async () => {
      const { sent, fetch } = server((url) => {
        if (url.endsWith("/init")) return json({ id: ID });
        if (url.endsWith("/finalize")) return json({ hold: HOLD });
        return json({ ok: true });
      });
      const api = createApiClient({ baseUrl: "", fetch });
      const target = { requestId: "req" };
      expect(await api.uploadInit({ "X-Upload-Token": "u" }, target)).toBe(ID);
      await api.uploadChunk(ID, 3, new Uint8Array([1, 2, 3]), target);
      expect(await api.uploadFinalize(ID, {}, target)).toEqual({ hold: HOLD });
      expect(sent.map((r) => r.url)).toEqual([
        "/api/request/req/upload/init",
        `/api/request/req/upload/${ID}/chunk?index=3`,
        `/api/request/req/upload/${ID}/finalize`,
      ]);
    });

    it("refuses an upload ID that is not the server's form", async () => {
      const { fetch } = server(() => json({ id: "../../etc" }));
      await expect(createApiClient({ baseUrl: "", fetch }).uploadInit({})).rejects.toThrow(
        "Upload init failed",
      );
    });

    it("passes on a refused chunk or finalize and ignores a malformed hold", async () => {
      const { fetch } = server((url) =>
        url.includes("/chunk")
          ? json({ error: "Too many pending chunks" }, 429)
          : json({ hold: "short" }),
      );
      const api = createApiClient({ baseUrl: "", fetch });
      await expect(api.uploadChunk(ID, 0, new Uint8Array(1))).rejects.toMatchObject({
        status: 429,
      });
      expect(await api.uploadFinalize(ID, {})).toEqual({ hold: undefined });
      const failing = server(() => json({ error: "Gone" }, 404));
      await expect(
        createApiClient({ baseUrl: "", fetch: failing.fetch }).uploadFinalize(ID, {}),
      ).rejects.toThrow("Gone");
    });

    it("gives a cancelled slot back without ever throwing", async () => {
      const { sent, fetch } = server(() => {
        throw new TypeError("offline");
      });
      await createApiClient({ baseUrl: "", fetch }).cancelRequestUpload("req", ID);
      expect(sent[0]).toMatchObject({ url: `/api/request/req/upload/${ID}`, method: "DELETE" });
    });

    it("stores the metadata with the owner token", async () => {
      const { sent, fetch } = server();
      await createApiClient({ baseUrl: "", fetch }).saveMeta(ID, "owner", "meta", "nonce");
      expect(sent[0]).toMatchObject({
        url: `/api/meta/${ID}`,
        method: "POST",
        headers: { "x-owner-token": "owner" },
        body: '{"encryptedMeta":"meta","nonce":"nonce"}',
      });
    });
  });

  describe("notes", () => {
    it("reads the info and a view of a note", async () => {
      const { sent, fetch } = server((url) =>
        url.endsWith("/view")
          ? json({ encryptedContent: "c", nonce: "n", viewCount: 1, maxViews: 2 })
          : json({ ...info, contentType: "blocks", maxViews: 2, viewCount: 0 }),
      );
      const api = createApiClient({ baseUrl: "", fetch });
      expect((await api.fetchNoteInfo("n1")).contentType).toBe("blocks");
      expect(await api.viewNote("n1", "auth")).toMatchObject({ viewCount: 1 });
      expect(sent[1]).toMatchObject({
        url: "/api/note/n1/view",
        method: "POST",
        body: '{"authToken":"auth"}',
      });
    });
  });

  describe("file requests", () => {
    it("sends each token in its own header", async () => {
      const brief = { ciphertext: "YQ", nonce: "Yg" };
      const { sent, fetch } = server((url, request) => {
        if (url.startsWith("/api/request/")) {
          return json({
            brief,
            open: true,
            closesAt: "2099-01-01T00:00:00.000Z",
            uploadsLeft: 1,
            maxUploadSize: 10,
            maxFilesPerUpload: 2,
          });
        }
        if (url === "/api/inbox/r" && request.method === "GET") {
          return json({
            vault: "dg",
            vaultNonce: "bg",
            brief,
            hasPassword: false,
            open: true,
            closesAt: "x",
            createdAt: "x",
            maxUploads: 1,
            maxSize: 1,
            usedUploads: 0,
            usedBytes: 0,
            uploads: [],
          });
        }
        return json({ ok: true });
      });
      const api = createApiClient({ baseUrl: "", fetch });
      expect((await api.fetchRequestForSender("r", "upload")).uploadsLeft).toBe(1);
      expect((await api.fetchInbox("r", "inbox")).uploads).toEqual([]);
      await api.deleteInboxFile("r", ID, "owner");
      await api.deleteRequest("r", "owner");
      expect(
        sent.map((r) => [
          r.method,
          r.url,
          Object.keys(r.headers).filter((h) => h.startsWith("x-")),
        ]),
      ).toEqual([
        ["GET", "/api/request/r", ["x-upload-token"]],
        ["GET", "/api/inbox/r", ["x-inbox-token"]],
        ["DELETE", `/api/inbox/r/file/${ID}`, ["x-inbox-owner-token"]],
        ["DELETE", "/api/inbox/r", ["x-inbox-owner-token"]],
      ]);
    });

    it("refuses an inbox longer than any request takes", async () => {
      const upload = {
        id: ID,
        size: 1,
        fileCount: 1,
        salt: "a",
        wrapEnc: "a",
        wrapCiphertext: "a",
        encryptedMeta: "a",
        metaNonce: "a",
        downloadCount: 0,
        maxDownloads: 1,
        expiresAt: "x",
        createdAt: "x",
      };
      const { fetch } = server(() =>
        json({
          vault: "a",
          vaultNonce: "a",
          brief: null,
          hasPassword: false,
          open: true,
          closesAt: "x",
          createdAt: "x",
          maxUploads: 1,
          maxSize: 1,
          usedUploads: 0,
          usedBytes: 0,
          uploads: Array(2001).fill(upload),
        }),
      );
      await expect(createApiClient({ baseUrl: "", fetch }).fetchInbox("r", "t")).rejects.toThrow();
    });
  });

  describe("the OIDC session", () => {
    it("answers the user, or null for nobody, an odd answer or no connection", async () => {
      const user = { sub: "1", name: "Ada", email: "ada@example.com" };
      const answering = (answer: () => Response) =>
        createApiClient({ baseUrl: "", fetch: server(answer).fetch });
      expect(await answering(() => json(user)).fetchAuthSession()).toEqual(user);
      expect(
        await answering(() => json({ error: "No session" }, 401)).fetchAuthSession(),
      ).toBeNull();
      expect(await answering(() => json({ sub: 1 })).fetchAuthSession()).toBeNull();
      expect(
        await answering(() => {
          throw new TypeError("offline");
        }).fetchAuthSession(),
      ).toBeNull();
    });
  });
});

describe("holdOf and isUploadId", () => {
  it("take only the forms the server gives out", () => {
    expect(holdOf({ hold: HOLD })).toBe(HOLD);
    expect(holdOf({ hold: "x" })).toBeUndefined();
    expect(holdOf(null)).toBeUndefined();
    expect(isUploadId(ID)).toBe(true);
    expect(isUploadId("../x")).toBe(false);
  });
});

describe("withUnlockedMeta", () => {
  it("takes the released metadata, or keeps the info's own from an older server", () => {
    expect(
      withUnlockedMeta(
        { ...info, encryptedMeta: "old", nonce: "o" },
        { encryptedMeta: "m", nonce: "n" },
      ),
    ).toMatchObject({
      encryptedMeta: "m",
      nonce: "n",
    });
    expect(
      withUnlockedMeta(
        { ...info, encryptedMeta: "old", nonce: "o" },
        { encryptedMeta: null, nonce: null },
      ),
    ).toMatchObject({
      encryptedMeta: "old",
      nonce: "o",
    });
  });
});
