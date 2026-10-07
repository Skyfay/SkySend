import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import {
  createFileRequest,
  deriveInboxKeys,
  fromBase64url,
  generateSalt,
  generateSecret,
  openRequestKey,
  unwrapFileSecret,
} from "@skysend/crypto";

/**
 * Runs the real upload worker in this thread: `self` is the global object, its messages
 * land in `posted`, and fetch answers like the server would.
 */
const posted: Array<{ type: string; [key: string]: unknown }> = [];
const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
let onmessage: (e: MessageEvent) => Promise<void>;

const REQUEST_ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const UPLOAD_ID = "11111111-2222-4333-8444-555555555555";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let initStatus = 201;
let initError = "File request is full";
let initId: string = UPLOAD_ID;
let finalizeStatus = 200;
let wsEnabled = false;
/** What the fake server answers to an init frame, when not ready. */
let wsInitReply: Record<string, unknown> | null = null;
/** Whether the fake WebSocket handshake fails, so the worker falls back to HTTP. */
let wsHandshakeFails = false;

/** A WebSocket that answers like the upload endpoint of the server. */
class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "blob";
  frames: Array<string | ArrayBuffer> = [];

  constructor(public url: string) {
    super();
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (wsHandshakeFails) {
        this.dispatchEvent(new Event("error"));
        return;
      }
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: string | ArrayBuffer) {
    this.frames.push(data);
    if (typeof data !== "string") return;
    const frame = JSON.parse(data) as { type: string };
    if (frame.type === "init") this.reply(wsInitReply ?? { type: "ready", id: UPLOAD_ID });
    if (frame.type === "finalize") this.reply({ type: "done", id: UPLOAD_ID });
  }

  close() {
    this.readyState = 3;
  }

  private reply(payload: Record<string, unknown>) {
    queueMicrotask(() =>
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) })),
    );
  }

  /** The JSON frames this socket sent, in order. */
  json(): Array<Record<string, unknown>> {
    return this.frames.filter((f): f is string => typeof f === "string").map((f) => JSON.parse(f));
  }
}

beforeAll(async () => {
  const scope = globalThis as unknown as { self: unknown; postMessage: unknown };
  scope.self = globalThis;
  scope.postMessage = (m: { type: string }) => posted.push(m);
  await import("../../src/lib/upload-worker.js");
  onmessage = (globalThis as unknown as { onmessage: typeof onmessage }).onmessage;
});

beforeEach(() => {
  posted.length = 0;
  requests.length = 0;
  initStatus = 201;
  initError = "File request is full";
  initId = UPLOAD_ID;
  finalizeStatus = 200;
  wsEnabled = false;
  wsInitReply = null;
  wsHandshakeFails = false;
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith("/api/config"))
        return json({ fileUploadConcurrentChunks: 2, fileUploadWs: wsEnabled });
      if (url.endsWith("/upload/init")) {
        return initStatus === 201
          ? json({ id: initId }, 201)
          : json({ error: initError }, initStatus);
      }
      if (url.includes("/chunk")) return json({ bytesWritten: 0 });
      if (url.endsWith("/finalize")) {
        return finalizeStatus === 200
          ? json({ id: UPLOAD_ID })
          : json({ error: "File request not found" }, finalizeStatus);
      }
      if (url.includes("/api/meta/")) return json({ ok: true });
      return json({ error: "unexpected" }, 500);
    }),
  );
});

function message(extra: Record<string, unknown>) {
  const file = new File(["hello world"], "hello.txt", { type: "text/plain" });
  return {
    data: {
      file,
      secret: generateSecret().buffer,
      salt: generateSalt().buffer,
      maxDownloads: 1,
      expireSec: 3600,
      password: "",
      metadata: { type: "single", name: "hello.txt", size: file.size, mimeType: "text/plain" },
      fileCount: 1,
      apiBase: "",
      ...extra,
    },
  } as MessageEvent;
}

describe("upload worker", () => {
  it("uploads a normal file through /api/upload and stores its metadata", async () => {
    await onmessage(message({}));
    expect(posted.at(-1)).toMatchObject({ type: "done", id: UPLOAD_ID });
    const urls = requests.map((r) => r.url);
    expect(urls).toContain("/api/upload/init");
    expect(urls).toContain(`/api/upload/${UPLOAD_ID}/chunk?index=0`);
    expect(urls).toContain(`/api/upload/${UPLOAD_ID}/finalize`);
    expect(urls).toContain(`/api/meta/${UPLOAD_ID}`);
    const finalize = requests.find((r) => r.url === `/api/upload/${UPLOAD_ID}/finalize`)!;
    expect((finalize.init!.headers as Record<string, string>)["X-Owner-Token"]).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    const meta = requests.find((r) => r.url === `/api/meta/${UPLOAD_ID}`)!;
    expect(Object.keys(JSON.parse(meta.init!.body as string)).sort()).toEqual([
      "encryptedMeta",
      "nonce",
    ]);
    expect(posted.some((m) => m.type === "session")).toBe(false);
  });

  it("uploads into a request and wraps the file secret so only the requester unwraps it", async () => {
    const created = await createFileRequest();
    const secret = generateSecret();
    await onmessage(
      message({
        secret: secret.slice().buffer,
        request: {
          id: REQUEST_ID,
          uploadToken: "upload-token",
          publicKey: created.local.publicKey.slice().buffer,
        },
      }),
    );
    expect(posted.at(-1)).toEqual({ type: "delivered", id: UPLOAD_ID });

    const base = `/api/request/${REQUEST_ID}/upload`;
    const init = requests.find((r) => r.url === `${base}/init`)!;
    const headers = init.init!.headers as Record<string, string>;
    expect(headers["X-Upload-Token"]).toBe("upload-token");
    expect(headers["X-Auth-Token"]).toBeUndefined();
    expect(headers["X-Owner-Token"]).toBeUndefined();
    expect(requests.some((r) => r.url === `${base}/${UPLOAD_ID}/chunk?index=0`)).toBe(true);
    // No metadata call and no share link: everything travels with the finalize.
    expect(requests.some((r) => r.url.includes("/api/meta/"))).toBe(false);

    const finalize = requests.find((r) => r.url === `${base}/${UPLOAD_ID}/finalize`)!;
    const body = JSON.parse(finalize.init!.body as string) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual([
      "encryptedMeta",
      "metaNonce",
      "wrapCiphertext",
      "wrapEnc",
    ]);
    const { inboxKey } = await deriveInboxKeys(created.local.inboxSecret);
    const key = await openRequestKey(
      created.server.vault,
      created.server.vaultNonce,
      inboxKey,
      created.server.brief,
    );
    const unwrapped = await unwrapFileSecret(key, REQUEST_ID, UPLOAD_ID, {
      enc: fromBase64url(body.wrapEnc!),
      ciphertext: fromBase64url(body.wrapCiphertext!),
    });
    expect(unwrapped).toEqual(secret);
  });

  it.each([
    [409, "File request is full", "full"],
    [410, "File request is closed", "closed"],
    [404, "File request not found", "gone"],
    [403, "File request service is disabled", "gone"],
    [413, "Upload exceeds the size this file request allows", "tooLarge"],
    [413, "File size exceeds remaining quota.", "quota"],
    [429, "Upload quota exceeded. Try again later.", "quota"],
    [429, "Too many requests", "Too many requests"],
  ])("names a refused init with %i %s as %s", async (status, error, code) => {
    const created = await createFileRequest();
    initStatus = status;
    initError = error;
    await onmessage(
      message({
        request: {
          id: REQUEST_ID,
          uploadToken: "t",
          publicKey: created.local.publicKey.slice().buffer,
        },
      }),
    );
    expect(posted.at(-1)).toEqual({ type: "error", message: code });
  });

  it("names a request deleted during the upload at finalize", async () => {
    const created = await createFileRequest();
    finalizeStatus = 404;
    await onmessage(
      message({
        request: {
          id: REQUEST_ID,
          uploadToken: "t",
          publicKey: created.local.publicKey.slice().buffer,
        },
      }),
    );
    expect(posted).toContainEqual({ type: "session", id: UPLOAD_ID });
    expect(posted.at(-1)).toEqual({ type: "error", message: "gone" });
  });

  it("sends no chunk when the server answers init with something that is not an upload ID", async () => {
    const created = await createFileRequest();
    initId = "../../etc";
    await onmessage(
      message({
        request: {
          id: REQUEST_ID,
          uploadToken: "t",
          publicKey: created.local.publicKey.slice().buffer,
        },
      }),
    );
    expect(posted.at(-1)).toEqual({ type: "error", message: "Upload init failed" });
    expect(requests.some((r) => r.url.includes("/chunk"))).toBe(false);
  });

  describe("over WebSocket", () => {
    const API = "http://localhost:3000";

    it("sends a normal upload with the same frames as before", async () => {
      wsEnabled = true;
      await onmessage(message({ apiBase: API }));
      expect(posted.at(-1)).toMatchObject({ type: "done", id: UPLOAD_ID });
      const ws = FakeWebSocket.instances[0]!;
      expect(ws.url).toBe("ws://localhost:3000/api/upload/ws");
      const [init, finalize] = ws.json();
      expect(Object.keys(init!).sort()).toEqual(["headers", "type"]);
      expect(finalize).toEqual({ type: "finalize" });
      expect(requests.some((r) => r.url.endsWith("/api/upload/init"))).toBe(false);
    });

    it("uploads into a request over the same WebSocket protocol", async () => {
      wsEnabled = true;
      const created = await createFileRequest();
      const secret = generateSecret();
      await onmessage(
        message({
          apiBase: API,
          secret: secret.slice().buffer,
          request: {
            id: REQUEST_ID,
            uploadToken: "upload-token",
            publicKey: created.local.publicKey.slice().buffer,
          },
        }),
      );
      expect(posted.at(-1)).toEqual({ type: "delivered", id: UPLOAD_ID });
      expect(posted).toContainEqual({ type: "transport", transport: "ws", fallback: false });
      const ws = FakeWebSocket.instances[0]!;
      expect(ws.url).toBe(`ws://localhost:3000/api/request/${REQUEST_ID}/upload/ws`);

      const [init, finalize] = ws.json() as [
        { request: Record<string, unknown> },
        Record<string, string>,
      ];
      expect(Object.keys(init.request).sort()).toEqual([
        "contentLength",
        "fileCount",
        "salt",
        "uploadToken",
      ]);
      expect(init.request.uploadToken).toBe("upload-token");
      expect(Object.keys(finalize).sort()).toEqual([
        "encryptedMeta",
        "metaNonce",
        "type",
        "wrapCiphertext",
        "wrapEnc",
      ]);
      const { inboxKey } = await deriveInboxKeys(created.local.inboxSecret);
      const key = await openRequestKey(
        created.server.vault,
        created.server.vaultNonce,
        inboxKey,
        created.server.brief,
      );
      const unwrapped = await unwrapFileSecret(key, REQUEST_ID, UPLOAD_ID, {
        enc: fromBase64url(finalize.wrapEnc!),
        ciphertext: fromBase64url(finalize.wrapCiphertext!),
      });
      expect(unwrapped).toEqual(secret);
      // Nothing went over HTTP, and nothing of the normal path ran.
      expect(requests.map((r) => r.url)).toEqual([`${API}/api/config`]);
    });

    it("falls back to HTTP chunks when the handshake fails", async () => {
      wsEnabled = true;
      wsHandshakeFails = true;
      const created = await createFileRequest();
      await onmessage(
        message({
          apiBase: API,
          request: {
            id: REQUEST_ID,
            uploadToken: "t",
            publicKey: created.local.publicKey.slice().buffer,
          },
        }),
      );
      expect(posted).toContainEqual({ type: "transport", transport: "http", fallback: true });
      expect(posted.at(-1)).toEqual({ type: "delivered", id: UPLOAD_ID });
      expect(requests.some((r) => r.url === `${API}/api/request/${REQUEST_ID}/upload/init`)).toBe(
        true,
      );
    });

    it("names a refusal over WebSocket the same as over HTTP", async () => {
      wsEnabled = true;
      wsInitReply = { type: "error", message: "File request is full", status: 409 };
      const created = await createFileRequest();
      await onmessage(
        message({
          apiBase: API,
          request: {
            id: REQUEST_ID,
            uploadToken: "t",
            publicKey: created.local.publicKey.slice().buffer,
          },
        }),
      );
      expect(posted.at(-1)).toEqual({ type: "error", message: "full" });
    });

    it("refuses an upload id the server did not make", async () => {
      wsEnabled = true;
      wsInitReply = { type: "ready", id: "../other-request" };
      const created = await createFileRequest();
      await onmessage(
        message({
          apiBase: API,
          request: {
            id: REQUEST_ID,
            uploadToken: "t",
            publicKey: created.local.publicKey.slice().buffer,
          },
        }),
      );
      expect(posted.at(-1)).toEqual({
        type: "error",
        message: "Server returned an invalid upload id",
      });
      expect(FakeWebSocket.instances[0]!.json().map((f) => f.type)).toEqual(["init"]);
    });
  });
});
