import { randomBytes as randomData } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createDecryptStream,
  decryptMetadata,
  deriveKeys,
  expectedBaseNonce,
  fromBase64url,
  generateSalt,
  generateSecret,
  type Argon2idHashFn,
  type RequestUploadMetadata,
} from "@skysend/crypto";
import { createApiClient } from "../src/api.js";
import {
  CHUNK_UPLOAD_SIZE,
  CHUNK_WINDOW,
  plaintextOf,
  toBase64,
  uploadEncrypted,
  type UploadOptions,
} from "../src/upload.js";

const UPLOAD_ID = "11111111-2222-4333-8444-555555555555";

const config = {
  enabledServices: ["file", "note"],
  fileMaxSize: 64 * 1024 ** 3,
  fileMaxFilesPerUpload: 200,
  fileExpireOptions: [86400],
  fileDefaultExpire: 86400,
  fileDownloadOptions: [1],
  fileDefaultDownload: 1,
  fileUploadQuotaBytes: 0,
  fileUploadQuotaWindow: 86400,
  fileUploadConcurrentChunks: 3,
  fileUploadWs: false,
  noteMaxSize: 1048576,
  noteExpireOptions: [86400],
  noteDefaultExpire: 86400,
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
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Never called: the tests upload without a password. */
const noArgon: Argon2idHashFn = async () => {
  throw new Error("no password expected");
};

/** A stream of `data` in pieces of `piece` bytes, pulled one at a time. */
function streamOf(data: Uint8Array, piece = 1 << 20): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= data.length) return controller.close();
      controller.enqueue(data.slice(at, at + piece));
      at += piece;
    },
  });
}

/** `count` MiB of zeros, the same buffer handed out again, so a large upload costs no memory. */
function zeros(count: number): ReadableStream<Uint8Array> {
  const piece = new Uint8Array(1 << 20);
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent++ === count) return controller.close();
      controller.enqueue(piece);
    },
  });
}

/**
 * A server for the HTTP transport. It keeps the chunks unless told not to, and the metadata.
 * `hold(index)` keeps a chunk request open until the test releases it, like the Nginx that
 * left one request hanging while the others passed.
 */
function fakeServer(
  setup: {
    baseUrl?: string;
    keep?: boolean;
    hold?: (index: number) => Promise<void> | undefined;
  } = {},
) {
  const chunks = new Map<number, Uint8Array>();
  const opened: number[] = [];
  let meta: { encryptedMeta: string; nonce: string } | null = null;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/config")) return json(config);
    if (url.endsWith("/api/upload/init")) return json({ id: UPLOAD_ID }, 201);
    const chunk = /\/chunk\?index=(\d+)$/.exec(url);
    if (chunk) {
      const index = Number(chunk[1]);
      opened.push(index);
      const body = new Uint8Array(await new Response(init!.body).arrayBuffer());
      await setup.hold?.(index);
      if (setup.keep !== false) chunks.set(index, body);
      return json({ bytesWritten: 0 });
    }
    if (url.endsWith("/finalize")) return json({ id: UPLOAD_ID });
    if (url.includes("/api/meta/")) {
      meta = JSON.parse(init!.body as string);
      return json({ ok: true });
    }
    return json({ error: "unexpected" }, 500);
  };
  return {
    api: createApiClient({
      baseUrl: setup.baseUrl ?? "https://send.example.com",
      fetch: fetch as typeof globalThis.fetch,
    }),
    chunks,
    opened,
    meta: () => meta,
  };
}

function options(
  server: ReturnType<typeof fakeServer>,
  plaintext: { stream: ReadableStream<Uint8Array>; size: number },
): UploadOptions {
  const metadata: RequestUploadMetadata = {
    type: "single",
    name: "data.bin",
    size: plaintext.size,
    mimeType: "application/octet-stream",
  };
  return {
    api: server.api,
    secret: generateSecret(),
    salt: generateSalt(),
    password: "",
    argon2id: noArgon,
    maxDownloads: 1,
    expireSec: 86400,
    fileCount: 1,
    metadata,
    plaintext,
  };
}

const bytesOf = (data: Uint8Array) => ({ stream: streamOf(data), size: data.length });

/** Decrypts what the fake server got, the way a recipient does. */
async function received(server: ReturnType<typeof fakeServer>, opts: UploadOptions) {
  const keys = await deriveKeys(opts.secret, opts.salt);
  const meta = server.meta()!;
  const metadata = await decryptMetadata(
    new Uint8Array(Buffer.from(meta.encryptedMeta, "base64")),
    new Uint8Array(Buffer.from(meta.nonce, "base64")),
    keys.metaKey,
  );
  const ordered = [...server.chunks.keys()].sort((a, b) => a - b).map((i) => server.chunks.get(i)!);
  const plain = new Response(
    streamOf(Buffer.concat(ordered)).pipeThrough(
      createDecryptStream(keys.fileKey, opts.plaintext.size, expectedBaseNonce(metadata)),
    ),
  );
  return { metadata, data: new Uint8Array(await plain.arrayBuffer()) };
}

describe("uploadEncrypted over HTTP chunks", () => {
  // Real encryption of 2.5 MB, which took ten seconds on a CI runner with coverage beside the
  // ZIP64 test.
  it(
    "uploads what a recipient decrypts, with the base nonce in the metadata",
    { timeout: 60_000 },
    async () => {
      const data = new Uint8Array(randomData(2_500_000));
      const server = fakeServer();
      const opts = options(server, bytesOf(data));
      const result = await uploadEncrypted(opts);

      expect(result).toMatchObject({ kind: "share", id: UPLOAD_ID });
      if (result.kind !== "share") throw new Error("unreachable");
      expect(fromBase64url(result.effectiveSecret)).toEqual(opts.secret);
      const { metadata, data: back } = await received(server, opts);
      expect(metadata.streamNonce).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(back).toEqual(data);
    },
  );

  it(
    "waits for a chunk that hangs instead of running into the limit of the server",
    { timeout: 60_000 },
    async () => {
      // Enough chunks to pass the window, the first held back until the test lets it go.
      const mib = (CHUNK_WINDOW + 8) * (CHUNK_UPLOAD_SIZE >> 20);
      let release!: () => void;
      const first = new Promise<void>((resolve) => (release = resolve));
      const server = fakeServer({
        keep: false,
        hold: (index) => (index === 0 ? first : undefined),
      });
      const upload = uploadEncrypted(options(server, { stream: zeros(mib), size: mib << 20 }));

      await vi.waitFor(() => expect(server.opened.length).toBe(CHUNK_WINDOW), { timeout: 30_000 });
      // Nothing more goes out while chunk 0 hangs, so the server never holds 64 waiting chunks.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(Math.max(...server.opened)).toBe(CHUNK_WINDOW - 1);

      release();
      await expect(upload).resolves.toMatchObject({ kind: "share" });
      expect(Math.max(...server.opened)).toBeGreaterThan(CHUNK_WINDOW);
    },
  );

  it("names the server and its error when the config does not arrive", async () => {
    const api = createApiClient({
      baseUrl: "https://send.example.com",
      fetch: (async () => json({ error: "down" }, 503)) as typeof fetch,
    });
    const opts = { ...options(fakeServer(), bytesOf(new Uint8Array(10))), api };
    await expect(uploadEncrypted(opts)).rejects.toThrow(
      "Server unreachable at https://send.example.com: down",
    );
  });
});

describe("uploadEncrypted over WebSocket", () => {
  /** Tries the socket of the server, which never opens, and returns the URL it asked for. */
  async function socketUrl(server: ReturnType<typeof fakeServer>, origin?: string) {
    const opened: string[] = [];
    const transports: unknown[] = [];
    await uploadEncrypted({
      ...options(server, bytesOf(new Uint8Array(10))),
      config: { ...(await server.api.fetchConfig()), fileUploadWs: true },
      ...(origin ? { origin } : {}),
      openWebSocket: (url: string) => {
        opened.push(url);
        throw new Error("no socket in this test");
      },
      onTransport: (...args) => transports.push(args),
    });
    return { opened, transports };
  }

  it("opens the socket of the server's origin, wss for https, and falls back to HTTP", async () => {
    const server = fakeServer();
    const { opened, transports } = await socketUrl(server);

    expect(opened).toEqual(["wss://send.example.com/api/upload/ws"]);
    expect(transports).toEqual([["http", true, "no socket in this test"]]);
    expect(server.chunks.size).toBe(1);
  });

  it("resolves the socket of a relative API against the origin it is given", async () => {
    const { opened } = await socketUrl(fakeServer({ baseUrl: "" }), "http://localhost:5173");
    expect(opened).toEqual(["ws://localhost:5173/api/upload/ws"]);
  });
});

describe("plaintextOf", () => {
  const file = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    return { size: bytes.length, stream: () => streamOf(bytes) };
  };

  it("streams one file as it is", async () => {
    const { stream, size } = plaintextOf([file("hello")], {
      type: "single",
      name: "a.txt",
      size: 5,
      mimeType: "text/plain",
    });
    expect(size).toBe(5);
    expect(await new Response(stream).text()).toBe("hello");
  });

  it("zips several files under the names of the metadata", async () => {
    const metadata = {
      type: "archive" as const,
      files: [
        { name: "a.txt", size: 1 },
        { name: "dir/b.txt", size: 2 },
      ],
      totalSize: 3,
    };
    const { stream, size } = plaintextOf([file("a"), file("bb")], metadata);
    const zip = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(zip.length).toBe(size);
    expect(new TextDecoder().decode(zip)).toContain("dir/b.txt");
  });

  it("refuses a file list that does not match the metadata", () => {
    const metadata = { type: "archive" as const, files: [{ name: "a", size: 1 }], totalSize: 1 };
    expect(() => plaintextOf([file("a"), file("b")], metadata)).toThrow(
      "The file list does not match",
    );
  });
});

describe("toBase64", () => {
  it("writes what Buffer writes, also past the argument limit of an engine", () => {
    const bytes = new Uint8Array(randomData(150_000));
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(toBase64(new Uint8Array(0))).toBe("");
  });
});
