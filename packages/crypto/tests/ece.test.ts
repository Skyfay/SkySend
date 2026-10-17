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
import { asBytes, constantTimeEqual, nonceXorCounter, randomBytes } from "../src/util.js";
import { flipped } from "./helpers.js";

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

describe("createEncryptStream nonce header", () => {
  it("should keep deriving record nonces from its own copy when a consumer overwrites the emitted header", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE + 100);
    const { readable, writable } = createEncryptStream(fileKey);
    const writer = writable.getWriter();
    const reader = readable.getReader();

    // A TransformStream starts with backpressure, so the first write only runs once the
    // reader pulls. The first chunk is too small for a record, so the stream emits the header.
    const firstWrite = writer.write(plaintext.slice(0, 10));
    const header = await reader.read();
    await firstWrite;
    expect(header.value?.length).toBe(NONCE_LENGTH);
    const original = header.value!.slice();
    header.value!.fill(0); // a consumer that reuses the chunk's memory

    const rest = writer.write(plaintext.slice(10)).then(() => writer.close());
    const records: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      records.push(value);
    }
    await rest;

    const encrypted = new Uint8Array(original.length + records.reduce((n, r) => n + r.length, 0));
    encrypted.set(original, 0);
    let offset = original.length;
    for (const record of records) {
      encrypted.set(record, offset);
      offset += record.length;
    }
    const decrypted = await collectStream(
      createReadableStream(encrypted, 8192).pipeThrough(
        createDecryptStream(fileKey, plaintext.length),
      ),
    );
    expect(constantTimeEqual(decrypted, plaintext)).toBe(true);
  });
});

/** A stream that hands out `data` in chunks of the given sizes, repeating the list. */
function chunkedStream(data: Uint8Array, sizes: number[]): ReadableStream<Uint8Array> {
  let offset = 0;
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + sizes[index++ % sizes.length]!, data.length);
      controller.enqueue(data.slice(offset, end));
      offset = end;
    },
  });
}

/**
 * Splits a stream into its nonce header and records and opens each record with Web Crypto
 * directly, so the format is checked without createDecryptStream: a 12-byte header, records of
 * ENCRYPTED_RECORD_SIZE but the last, record i under the header XOR i.
 */
async function openByFormat(fileKey: CryptoKey, encrypted: Uint8Array): Promise<Uint8Array> {
  const header = encrypted.subarray(0, NONCE_LENGTH);
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let at = NONCE_LENGTH, i = 0; at < encrypted.length; at += ENCRYPTED_RECORD_SIZE, i++) {
    const record = encrypted.subarray(at, Math.min(at + ENCRYPTED_RECORD_SIZE, encrypted.length));
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: asBytes(nonceXorCounter(header, i)), tagLength: TAG_LENGTH * 8 },
        fileKey,
        asBytes(record),
      ),
    );
    parts.push(plain);
    total += plain.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// Chunk sizes that land on, before and after every record boundary, plus ones that take
// several records at once, the way Chromium reads a file and a fetch body can arrive.
const CHUNKINGS: Array<[string, number[]]> = [
  ["tiny chunks", [7]],
  ["one byte short of a record", [RECORD_SIZE - 1]],
  ["exactly a record", [RECORD_SIZE]],
  ["one byte over a record", [RECORD_SIZE + 1]],
  ["an encrypted record", [ENCRYPTED_RECORD_SIZE]],
  ["several records at once", [3 * RECORD_SIZE + 123]],
  ["mixed sizes", [1, 65_535, 13, 2 * RECORD_SIZE + 9, 100_000, 5]],
];

describe("ECE record layout", () => {
  for (const [name, sizes] of CHUNKINGS) {
    it(`should write records of the format from ${name}`, async () => {
      const fileKey = await getFileKey();
      const plaintext = randomBytes(4 * RECORD_SIZE + 777);
      const encrypted = await collectStream(
        chunkedStream(plaintext, sizes).pipeThrough(createEncryptStream(fileKey)),
      );
      expect(encrypted.length).toBe(calculateEncryptedSize(plaintext.length));
      expect(constantTimeEqual(await openByFormat(fileKey, encrypted), plaintext)).toBe(true);
    });

    it(`should decrypt a stream that arrives in ${name}`, async () => {
      const fileKey = await getFileKey();
      const plaintext = randomBytes(4 * RECORD_SIZE + 777);
      const encrypted = await collectStream(
        chunkedStream(plaintext, [RECORD_SIZE]).pipeThrough(createEncryptStream(fileKey)),
      );
      const decrypted = await collectStream(
        chunkedStream(encrypted, sizes).pipeThrough(
          createDecryptStream(fileKey, plaintext.length),
        ),
      );
      expect(constantTimeEqual(decrypted, plaintext)).toBe(true);
    });
  }

  it("should write no empty record when the input ends on a record boundary", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(2 * RECORD_SIZE);
    for (const sizes of [[RECORD_SIZE], [plaintext.length], [RECORD_SIZE - 1]]) {
      const encrypted = await collectStream(
        chunkedStream(plaintext, sizes).pipeThrough(createEncryptStream(fileKey)),
      );
      expect(encrypted.length).toBe(NONCE_LENGTH + 2 * ENCRYPTED_RECORD_SIZE);
      const decrypted = await collectStream(
        chunkedStream(encrypted, sizes).pipeThrough(createDecryptStream(fileKey, plaintext.length)),
      );
      expect(constantTimeEqual(decrypted, plaintext)).toBe(true);
    }
  });

  it("should keep what it needs of a chunk when the producer reuses its memory", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE + 5000);
    const original = plaintext.slice();

    // Encrypt: every chunk is overwritten right after the stream took it.
    const { readable, writable } = createEncryptStream(fileKey);
    const encryptedPromise = collectStream(readable);
    const writer = writable.getWriter();
    for (const [start, end] of [
      [0, 1000],
      [1000, RECORD_SIZE + 2000],
      [RECORD_SIZE + 2000, plaintext.length],
    ] as const) {
      const chunk = plaintext.slice(start, end);
      await writer.write(chunk);
      chunk.fill(0);
    }
    await writer.close();
    const encrypted = await encryptedPromise;
    expect(constantTimeEqual(await openByFormat(fileKey, encrypted), original)).toBe(true);

    // Decrypt: the same, with chunks that end inside the header and inside a record.
    const decryptor = createDecryptStream(fileKey, original.length);
    const decryptedPromise = collectStream(decryptor.readable);
    const decryptWriter = decryptor.writable.getWriter();
    for (const [start, end] of [
      [0, 5],
      [5, 3000],
      [3000, ENCRYPTED_RECORD_SIZE + 50],
      [ENCRYPTED_RECORD_SIZE + 50, encrypted.length],
    ] as const) {
      const chunk = encrypted.slice(start, end);
      await decryptWriter.write(chunk);
      chunk.fill(0);
    }
    await decryptWriter.close();
    expect(constantTimeEqual(await decryptedPromise, original)).toBe(true);
  });

  it("should refuse a stream whose last record is cut down to its tag in any chunking", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(2 * RECORD_SIZE + 100);
    const encrypted = await collectStream(
      chunkedStream(plaintext, [RECORD_SIZE]).pipeThrough(createEncryptStream(fileKey)),
    );
    // The full records stay, the last one keeps only TAG_LENGTH bytes.
    const cut = encrypted.slice(0, NONCE_LENGTH + 2 * ENCRYPTED_RECORD_SIZE + TAG_LENGTH);
    for (const [, sizes] of CHUNKINGS) {
      await expect(
        collectStream(chunkedStream(cut, sizes).pipeThrough(createDecryptStream(fileKey))),
      ).rejects.toThrow("too short to contain auth tag");
    }
  });
});

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
    const tampered = flipped(encrypted, NONCE_LENGTH + 5);

    await expect(
      collectStream(
        createReadableStream(tampered, 1024).pipeThrough(createDecryptStream(fileKey)),
      ),
    ).rejects.toThrow("corrupted or tampered");
  });

  it("should fail if nonce header is incomplete (< 12 bytes)", async () => {
    const fileKey = await getFileKey();

    await expect(
      collectStream(
        createReadableStream(new Uint8Array(5)).pipeThrough(createDecryptStream(fileKey)),
      ),
    ).rejects.toThrow("Encrypted stream is empty - missing nonce header");
  });

  it("should fail if ciphertext after nonce is too short to contain auth tag", async () => {
    const fileKey = await getFileKey();

    // 12-byte nonce header + 8 bytes of garbage: buffer.length (8) <= TAG_LENGTH (16)
    const tooShort = new Uint8Array(NONCE_LENGTH + 8);
    crypto.getRandomValues(tooShort);

    await expect(
      collectStream(
        createReadableStream(tooShort).pipeThrough(createDecryptStream(fileKey)),
      ),
    ).rejects.toThrow("too short to contain auth tag");
  });

  it("should fail if encrypted records are reordered (position-binding via counter nonce)", async () => {
    const fileKey = await getFileKey();
    // Exactly 2 full records so we can cleanly swap them
    const plaintext = randomBytes(RECORD_SIZE * 2);

    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey)),
    );

    // Layout: [nonce 12B][record0 ENCRYPTED_RECORD_SIZE][record1 ENCRYPTED_RECORD_SIZE]
    const nonce = encrypted.slice(0, NONCE_LENGTH);
    const record0 = encrypted.slice(NONCE_LENGTH, NONCE_LENGTH + ENCRYPTED_RECORD_SIZE);
    const record1 = encrypted.slice(NONCE_LENGTH + ENCRYPTED_RECORD_SIZE);

    // Swap records: record1 first, record0 second
    const reordered = new Uint8Array(encrypted.length);
    reordered.set(nonce, 0);
    reordered.set(record1, NONCE_LENGTH);
    reordered.set(record0, NONCE_LENGTH + ENCRYPTED_RECORD_SIZE);

    // Decryption must fail because each record was encrypted with a counter-specific nonce.
    // Record1 (encrypted with counter=1) cannot be decrypted with counter=0 nonce.
    await expect(
      collectStream(
        createReadableStream(reordered, 8192).pipeThrough(createDecryptStream(fileKey)),
      ),
    ).rejects.toThrow("corrupted or tampered");
  });

  /** Two full records swapped, with the header XORed by 1 so each still finds its nonce. */
  function reorderWithHeader(encrypted: Uint8Array): Uint8Array {
    const out = new Uint8Array(encrypted.length);
    out.set(encrypted.subarray(0, NONCE_LENGTH), 0);
    out[NONCE_LENGTH - 1] = out[NONCE_LENGTH - 1]! ^ 1;
    const start = (i: number) => NONCE_LENGTH + i * ENCRYPTED_RECORD_SIZE;
    out.set(encrypted.subarray(start(1), start(2)), start(0));
    out.set(encrypted.subarray(start(0), start(1)), start(1));
    return out;
  }

  it("should NOT detect records reordered along with the header without the base nonce", async () => {
    // The counter is XORed into the header's nonce, so XORing the header by k maps record i
    // onto the nonce of record i XOR k. Each record still authenticates, at the same size.
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE * 2);
    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey)),
    );

    const decrypted = await collectStream(
      createReadableStream(reorderWithHeader(encrypted), 8192).pipeThrough(
        createDecryptStream(fileKey, plaintext.length),
      ),
    );
    expect(decrypted.subarray(0, RECORD_SIZE)).toEqual(plaintext.subarray(RECORD_SIZE));
  });

  it("should fail records reordered along with the header when the base nonce is checked", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE * 2);
    const baseNonce = randomBytes(NONCE_LENGTH);
    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey, baseNonce)),
    );
    expect(encrypted.subarray(0, NONCE_LENGTH)).toEqual(baseNonce);

    await expect(
      collectStream(
        createReadableStream(reorderWithHeader(encrypted), 8192).pipeThrough(
          createDecryptStream(fileKey, plaintext.length, baseNonce),
        ),
      ),
    ).rejects.toThrow("corrupted or tampered");
  });

  it("should decrypt with the base nonce it was encrypted with, over a header split into pieces", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE + 5);
    const baseNonce = randomBytes(NONCE_LENGTH);
    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey, baseNonce)),
    );
    const decrypted = await collectStream(
      createReadableStream(encrypted, 5).pipeThrough(
        createDecryptStream(fileKey, plaintext.length, baseNonce),
      ),
    );
    expect(decrypted).toEqual(plaintext);
  });

  it("should refuse a base nonce of the wrong length on both sides", async () => {
    const fileKey = await getFileKey();
    expect(() => createEncryptStream(fileKey, randomBytes(NONCE_LENGTH - 1))).toThrow("12 bytes");
    expect(() => createDecryptStream(fileKey, undefined, randomBytes(NONCE_LENGTH + 1))).toThrow(
      "12 bytes",
    );
  });

  it("should keep its own copy of the base nonce", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE * 2);
    const baseNonce = randomBytes(NONCE_LENGTH);
    const expected = baseNonce.slice();
    const encrypting = createReadableStream(plaintext).pipeThrough(
      createEncryptStream(fileKey, baseNonce),
    );
    baseNonce.fill(0);
    const encrypted = await collectStream(encrypting);
    const decrypted = await collectStream(
      createReadableStream(encrypted).pipeThrough(
        createDecryptStream(fileKey, plaintext.length, expected),
      ),
    );
    expect(decrypted).toEqual(plaintext);
  });

  it("should NOT detect truncation without expectedPlaintextSize (application responsibility)", async () => {
    // ECE provides per-record authentication, not end-of-stream authentication.
    // Without expectedPlaintextSize, truncation is undetected at the crypto layer.
    // Pass expectedPlaintextSize (from decrypted metadata) to enable the check.
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE * 2);

    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey)),
    );

    // Remove the last record entirely
    const truncated = encrypted.slice(0, NONCE_LENGTH + ENCRYPTED_RECORD_SIZE);

    // Decryption succeeds but returns only the first record
    const decrypted = await collectStream(
      createReadableStream(truncated, 8192).pipeThrough(createDecryptStream(fileKey)),
    );

    expect(decrypted.length).toBe(RECORD_SIZE); // only first record decrypted
    expect(constantTimeEqual(decrypted, plaintext.slice(0, RECORD_SIZE))).toBe(true);
  });

  it("should detect truncation when expectedPlaintextSize is provided", async () => {
    const fileKey = await getFileKey();
    const plaintext = randomBytes(RECORD_SIZE * 2);

    const encrypted = await collectStream(
      createReadableStream(plaintext).pipeThrough(createEncryptStream(fileKey)),
    );

    // Truncate: remove last record
    const truncated = encrypted.slice(0, NONCE_LENGTH + ENCRYPTED_RECORD_SIZE);

    // Pass the real plaintext size - stream should now reject the truncated data
    await expect(
      collectStream(
        createReadableStream(truncated, 8192).pipeThrough(
          createDecryptStream(fileKey, plaintext.length),
        ),
      ),
    ).rejects.toThrow("Stream truncation detected");
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
