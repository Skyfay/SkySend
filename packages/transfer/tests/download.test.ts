import { describe, expect, it } from "vitest";
import { argon2id } from "hash-wasm";
import {
  applyPasswordProtection,
  createEncryptStream,
  deriveKeyFromPassword,
  deriveKeys,
  encryptMetadata,
  ENCRYPTED_RECORD_SIZE,
  generateSalt,
  generateSecret,
  NONCE_LENGTH,
  PASSWORD_SALT_LENGTH,
  randomBytes,
  RECORD_SIZE,
  toBase64url,
  type Argon2idHashFn,
  type FileMetadata,
} from "@skysend/crypto";
import {
  decryptedStream,
  decryptUploadMetadata,
  fromBase64,
  keysFromLink,
  keysFromSecret,
} from "../src/download.js";
import { toBase64 } from "../src/upload.js";

const hashWasm: Argon2idHashFn = async (password, salt, params) =>
  new Uint8Array(
    await argon2id({
      password,
      salt,
      parallelism: params.parallelism,
      iterations: params.iterations,
      memorySize: params.memory,
      hashLength: params.hashLength,
      outputType: "binary",
    }),
  );

const streamOf = (data: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

const collect = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer());

describe("keysFromLink", () => {
  it("derives the keys of a link without a password", async () => {
    const secret = generateSecret();
    const salt = generateSalt();
    const keys = await keysFromLink(toBase64url(secret), toBase64url(salt));

    expect(keys.secret).toEqual(secret);
    expect(keys.authToken).toBe((await keysFromSecret(secret, toBase64url(salt))).authToken);
  });

  it("takes the password protection off a protected link", async () => {
    const secret = generateSecret();
    const salt = generateSalt();
    const passwordSalt = randomBytes(PASSWORD_SALT_LENGTH);
    const { key } = await deriveKeyFromPassword("correct horse battery", passwordSalt, hashWasm);
    // What the link of a protected share holds: the secret with the password key XORed in.
    const inLink = applyPasswordProtection(secret, key);

    const keys = await keysFromLink(toBase64url(inLink), toBase64url(salt), {
      password: "correct horse battery",
      saltB64: toBase64url(passwordSalt),
      argon2id: hashWasm,
    });
    expect(keys.secret).toEqual(secret);
  });

  it("needs the salt of the password", async () => {
    await expect(
      keysFromLink(toBase64url(generateSecret()), toBase64url(generateSalt()), {
        password: "x",
        saltB64: "",
        argon2id: hashWasm,
      }),
    ).rejects.toThrow("Missing password salt");
  });
});

describe("decryptUploadMetadata", () => {
  it("reads the metadata the server keeps in standard base64", async () => {
    const { metaKey } = await deriveKeys(generateSecret(), generateSalt());
    const metadata: FileMetadata = {
      type: "single",
      name: "a.txt",
      size: 3,
      mimeType: "text/plain",
    };
    const encrypted = await encryptMetadata(metadata, metaKey);
    const info = { encryptedMeta: toBase64(encrypted.ciphertext), nonce: toBase64(encrypted.iv) };

    expect(await decryptUploadMetadata(info, metaKey)).toMatchObject(metadata);
    expect(await decryptUploadMetadata({ encryptedMeta: null, nonce: null }, metaKey)).toBeNull();
  });

  it("decodes base64 the way Buffer does", () => {
    const bytes = randomBytes(300);
    expect(fromBase64(Buffer.from(bytes).toString("base64"))).toEqual(bytes);
  });
});

describe("decryptedStream", () => {
  /** Two records encrypted under the base nonce the metadata names. */
  async function upload() {
    const { fileKey } = await deriveKeys(generateSecret(), generateSalt());
    const plaintext = randomBytes(RECORD_SIZE * 2);
    const baseNonce = randomBytes(NONCE_LENGTH);
    const ciphertext = await collect(
      streamOf(plaintext).pipeThrough(createEncryptStream(fileKey, baseNonce)),
    );
    const metadata: FileMetadata = {
      type: "single",
      name: "a.bin",
      size: plaintext.length,
      mimeType: "application/octet-stream",
      streamNonce: toBase64url(baseNonce),
    };
    return { fileKey, plaintext, ciphertext, metadata };
  }

  it("decrypts what was sent", async () => {
    const { fileKey, plaintext, ciphertext, metadata } = await upload();
    expect(await collect(decryptedStream(streamOf(ciphertext), metadata, fileKey))).toEqual(
      plaintext,
    );
  });

  it("refuses records the server reordered along with the header", async () => {
    const { fileKey, ciphertext, metadata } = await upload();
    // XOR 1 into the header maps the nonces of record 0 and 1 onto each other, so each record
    // still authenticates. Only the base nonce in the metadata gives the swap away.
    const reordered = new Uint8Array(ciphertext.length);
    reordered.set(ciphertext.subarray(0, NONCE_LENGTH));
    reordered[NONCE_LENGTH - 1]! ^= 1;
    const start = (i: number) => NONCE_LENGTH + i * ENCRYPTED_RECORD_SIZE;
    reordered.set(ciphertext.subarray(start(1), start(2)), start(0));
    reordered.set(ciphertext.subarray(start(0), start(1)), start(1));

    await expect(
      collect(decryptedStream(streamOf(reordered), metadata, fileKey)),
    ).rejects.toThrow();
  });

  it("refuses a stream the server cut short", async () => {
    const { fileKey, ciphertext, metadata } = await upload();
    const short = ciphertext.subarray(0, ciphertext.length - ENCRYPTED_RECORD_SIZE);
    await expect(collect(decryptedStream(streamOf(short), metadata, fileKey))).rejects.toThrow(
      /truncat/i,
    );
  });
});
