import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  createEncryptStream,
  deriveKeys,
  ENCRYPTED_RECORD_SIZE,
  NONCE_LENGTH,
  RECORD_SIZE,
  randomBytes,
} from "@skysend/crypto";

const SOURCE = readFileSync(new URL("../../public/download-sw.js", import.meta.url), "utf8");

interface Worker {
  handleDownload(config: object, id: string, done: () => void): Promise<Response>;
}

/** The worker's script in a context of its own, the network answering with `body`. */
function loadWorker(body: Response): Worker {
  const context = createContext({
    self: { addEventListener: () => {} },
    BroadcastChannel: class {
      onmessage = null;
      postMessage() {}
    },
    fetch: async () => body,
    crypto: globalThis.crypto,
    Response,
    Headers,
    ReadableStream,
    TextEncoder,
    URL,
    DOMException,
    console: { debug() {}, warn() {}, error() {} },
    setTimeout,
  });
  runInContext(SOURCE, context);
  return context as unknown as Worker;
}

describe("download-sw.js", () => {
  it("hands over a download that the browser may neither guess nor run", async () => {
    const worker = loadWorker(
      new Response(new Uint8Array(100), { headers: { "Content-Type": "application/octet-stream" } }),
    );
    const response = await worker.handleDownload(
      {
        url: "/api/download/x",
        authToken: "t",
        tokenHeader: "X-Auth-Token",
        secret: new ArrayBuffer(32),
        salt: new ArrayBuffer(16),
        filename: "page.html",
        mimeType: "text/html",
        size: 100,
        plaintextSize: null,
      },
      "id",
      () => {},
    );
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
  });

  /** Two full records encrypted with `baseNonce` under the keys of `secret` and `salt`. */
  async function twoRecords(secret: Uint8Array, salt: Uint8Array, baseNonce: Uint8Array) {
    const { fileKey } = await deriveKeys(secret, salt);
    const plaintext = randomBytes(RECORD_SIZE * 2);
    const encrypted = new Uint8Array(
      await new Response(
        new Blob([plaintext as BlobPart]).stream().pipeThrough(createEncryptStream(fileKey, baseNonce)),
      ).arrayBuffer(),
    );
    return { plaintext, encrypted };
  }

  /** The records swapped, with the header XORed by 1 so each still finds its nonce. */
  function reorderWithHeader(encrypted: Uint8Array): Uint8Array {
    const out = new Uint8Array(encrypted.length);
    out.set(encrypted.subarray(0, NONCE_LENGTH), 0);
    out[NONCE_LENGTH - 1] = out[NONCE_LENGTH - 1]! ^ 1;
    const start = (i: number) => NONCE_LENGTH + i * ENCRYPTED_RECORD_SIZE;
    out.set(encrypted.subarray(start(1), start(2)), start(0));
    out.set(encrypted.subarray(start(0), start(1)), start(1));
    return out;
  }

  async function download(body: Uint8Array, secret: Uint8Array, salt: Uint8Array, baseNonce: Uint8Array | null) {
    const worker = loadWorker(new Response(body as BodyInit));
    const response = await worker.handleDownload(
      {
        url: "/api/download/x",
        authToken: "t",
        tokenHeader: "X-Auth-Token",
        secret: secret.slice().buffer,
        salt: salt.slice().buffer,
        filename: "file.bin",
        mimeType: "application/octet-stream",
        size: body.length,
        plaintextSize: RECORD_SIZE * 2,
        baseNonce,
      },
      "id",
      () => {},
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  it("refuses records reordered along with the header when the metadata names the base nonce", async () => {
    const secret = randomBytes(32);
    const salt = randomBytes(32);
    const baseNonce = randomBytes(NONCE_LENGTH);
    const { plaintext, encrypted } = await twoRecords(secret, salt, baseNonce);

    expect(await download(encrypted, secret, salt, baseNonce)).toEqual(plaintext);
    await expect(download(reorderWithHeader(encrypted), secret, salt, baseNonce)).rejects.toThrow();
    // An upload of a client that put no base nonce into the metadata still opens, as before.
    const legacy = await download(reorderWithHeader(encrypted), secret, salt, null);
    expect(legacy.subarray(0, RECORD_SIZE)).toEqual(plaintext.subarray(RECORD_SIZE));
  });
});
