import { describe, expect, it } from "vitest";
import {
  createEncryptStream,
  createDecryptStream,
  calculateEncryptedSize,
  calculatePlaintextSize,
  RECORD_SIZE,
  TAG_LENGTH,
  NONCE_LENGTH,
  ENCRYPTED_RECORD_SIZE,
} from "../src/ece.js";
import { deriveKeys, generateSecret, generateSalt } from "../src/keychain.js";
import { constantTimeEqual, randomBytes } from "../src/util.js";

/** Helper: collect all chunks from a ReadableStream into a single Uint8Array. */
async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Helper: create a ReadableStream from a Uint8Array with specified chunk sizes. */
function createReadableStream(
  data: Uint8Array,
  chunkSize = RECORD_SIZE,
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, data.length);
      controller.enqueue(data.slice(offset, end));
      offset = end;
    },
  });
}

async function getFileKey(): Promise<CryptoKey> {
  const secret = generateSecret();
  const salt = generateSalt();
  const keys = await deriveKeys(secret, salt);
  return keys.fileKey;
}

describe("ECE streaming encryption/decryption", () => {
  it("should encrypt and decrypt a small payload", async () => {
    const fileKey = await getFileKey();
    const plaintext = new TextEncoder().encode("Hello, SkySend!");

    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey)),
    );

    // Encrypted output should start with 12-byte nonce
    expect(encrypted.length).toBeGreaterThan(NONCE_LENGTH);

    const decrypted = await collectStream(
      createReadableStream(encrypted, 1024).pipeThrough(createDecryptStream(fileKey)),
    );

    expect(new TextDecoder().decode(decrypted)).toBe("Hello, SkySend!");
  });

  it("should encrypt and decrypt an empty payload", async () => {
    const fileKey = await getFileKey();
    const plaintext = new Uint8Array(0);

    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey)),
    );

    // Should only contain the nonce header
    expect(encrypted.length).toBe(NONCE_LENGTH);

    const decrypted = await collectStream(
      createReadableStream(encrypted).pipeThrough(createDecryptStream(fileKey)),
    );

    expect(decrypted.length).toBe(0);
  });

  it("should encrypt and decrypt exactly one record", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE);

    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey)),
    );

    expect(encrypted.length).toBe(NONCE_LENGTH + ENCRYPTED_RECORD_SIZE);

    const decrypted = await collectStream(
      createReadableStream(encrypted, 4096).pipeThrough(createDecryptStream(fileKey)),
    );

    expect(constantTimeEqual(decrypted, plaintext)).toBe(true);
  });

  it("should encrypt and decrypt multiple records", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE * 3 + 1000); // 3 full + 1 partial

    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey)),
    );

    const expectedSize = calculateEncryptedSize(plaintext.length);
    expect(encrypted.length).toBe(expectedSize);

    const decrypted = await collectStream(
      createReadableStream(encrypted, 8192).pipeThrough(createDecryptStream(fileKey)),
    );

    expect(constantTimeEqual(decrypted, plaintext)).toBe(true);
  });

  it("should handle input in small chunks", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE + 500);

    // Feed data in tiny 100-byte chunks
    const encrypted = await collectStream(
      createReadableStream(plaintext, 100).pipeThrough(createEncryptStream(fileKey)),
    );

    const decrypted = await collectStream(
      createReadableStream(encrypted, 100).pipeThrough(createDecryptStream(fileKey)),
    );

    expect(constantTimeEqual(decrypted, plaintext)).toBe(true);
  });

  it("should handle input in single large chunk", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE * 2 + 500);

    // Feed all data at once
    const encrypted = await collectStream(
      createReadableStream(plaintext, plaintext.length).pipeThrough(
        createEncryptStream(fileKey),
      ),
    );

    const decrypted = await collectStream(
      createReadableStream(encrypted, encrypted.length).pipeThrough(
        createDecryptStream(fileKey),
      ),
    );

    expect(constantTimeEqual(decrypted, plaintext)).toBe(true);
  });

  it("should produce different ciphertext for same plaintext (random nonce)", async () => {
    const fileKey = await getFileKey();
    const plaintext = new TextEncoder().encode("deterministic test");

    const encrypted1 = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey)),
    );
    const encrypted2 = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey)),
    );

    // Nonces should differ
    const nonce1 = encrypted1.slice(0, NONCE_LENGTH);
    const nonce2 = encrypted2.slice(0, NONCE_LENGTH);
    expect(constantTimeEqual(nonce1, nonce2)).toBe(false);

    // Ciphertext should differ
    expect(constantTimeEqual(encrypted1, encrypted2)).toBe(false);

    // But both should decrypt to the same plaintext
    const dec1 = await collectStream(
      createReadableStream(encrypted1, 1024).pipeThrough(createDecryptStream(fileKey)),
    );
    const dec2 = await collectStream(
      createReadableStream(encrypted2, 1024).pipeThrough(createDecryptStream(fileKey)),
    );
    expect(constantTimeEqual(dec1, dec2)).toBe(true);
  });

  it("should fail decryption with wrong key", async () => {
    const fileKey1 = await getFileKey();
    const fileKey2 = await getFileKey();
    const plaintext = new TextEncoder().encode("secret data");

    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey1)),
    );

    await expect(
      collectStream(
        createReadableStream(encrypted, 1024).pipeThrough(createDecryptStream(fileKey2)),
      ),
    ).rejects.toThrow("corrupted or tampered");
  });

  it("should fail decryption if ciphertext is tampered", async () => {
    const fileKey = await getFileKey();
    const plaintext = new TextEncoder().encode("tamper test");

    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey)),
    );

    // Flip a byte in the ciphertext (after the nonce)
    const tampered = new Uint8Array(encrypted);
    tampered[NONCE_LENGTH + 5] ^= 0xff;

    await expect(
      collectStream(
        createReadableStream(tampered, 1024).pipeThrough(createDecryptStream(fileKey)),
      ),
    ).rejects.toThrow("corrupted or tampered");
  });

  it("should fail if nonce is missing", async () => {
    const fileKey = await getFileKey();

    await expect(
      collectStream(
        createReadableStream(new Uint8Array(5)).pipeThrough(createDecryptStream(fileKey)),
      ),
    ).rejects.toThrow("empty");
  });
});

describe("calculateEncryptedSize", () => {
  it("should return nonce length for empty input", () => {
    expect(calculateEncryptedSize(0)).toBe(NONCE_LENGTH);
  });

  it("should calculate correctly for one byte", () => {
    // 1 byte -> 1 record -> NONCE + 1 + TAG
    expect(calculateEncryptedSize(1)).toBe(NONCE_LENGTH + 1 + TAG_LENGTH);
  });

  it("should calculate correctly for exactly one record", () => {
    expect(calculateEncryptedSize(RECORD_SIZE)).toBe(NONCE_LENGTH + ENCRYPTED_RECORD_SIZE);
  });

  it("should calculate correctly for one record + 1 byte", () => {
    expect(calculateEncryptedSize(RECORD_SIZE + 1)).toBe(
      NONCE_LENGTH + ENCRYPTED_RECORD_SIZE + 1 + TAG_LENGTH,
    );
  });

  it("should calculate correctly for multiple exact records", () => {
    const n = 5;
    expect(calculateEncryptedSize(RECORD_SIZE * n)).toBe(
      NONCE_LENGTH + ENCRYPTED_RECORD_SIZE * n,
    );
  });
});

describe("calculatePlaintextSize", () => {
  it("should return 0 for nonce-only input", () => {
    expect(calculatePlaintextSize(NONCE_LENGTH)).toBe(0);
  });

  it("should be the inverse of calculateEncryptedSize", () => {
    const sizes = [0, 1, 100, RECORD_SIZE - 1, RECORD_SIZE, RECORD_SIZE + 1, RECORD_SIZE * 3 + 500];
    for (const size of sizes) {
      const encrypted = calculateEncryptedSize(size);
      expect(calculatePlaintextSize(encrypted)).toBe(size);
    }
  });

  it("should throw for invalid partial record size", () => {
    // NONCE + a few bytes that's less than a tag
    expect(() => calculatePlaintextSize(NONCE_LENGTH + TAG_LENGTH)).toThrow("partial record");
  });
});
