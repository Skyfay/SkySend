/**
 * Encrypted Content-Encoding (ECE) - Streaming AES-256-GCM.
 *
 * Encrypts/decrypts data in fixed-size records (chunks) using AES-256-GCM
 * with counter-based nonces to enable streaming without buffering the
 * entire payload in memory.
 *
 * Record format (encrypted):
 *   [ciphertext (up to RECORD_SIZE bytes)] [GCM auth tag (16 bytes)]
 *
 * The base nonce (12 bytes) is generated randomly and prepended to the
 * encrypted stream as a header. Each record uses nonce = baseNonce XOR counter.
 *
 * Stream layout:
 *   [baseNonce (12 bytes)] [record 0] [record 1] ... [record N]
 *
 * Security invariants:
 * - Each record uses a unique nonce (counter-based XOR)
 * - The GCM tag authenticates each record independently
 * - The last record may be shorter than RECORD_SIZE
 * - Maximum 2^32 records per stream (counter is 32-bit)
 * - Base nonce is random per encryption to prevent nonce reuse
 */

import { asBytes, constantTimeEqual, nonceXorCounter, randomBytes } from "./util.js";

/** TypeScript 6 Uint8Array with any buffer backing. */
type AnyBytes = Uint8Array<ArrayBufferLike>;

/** Plaintext record size: 64 KB. */
export const RECORD_SIZE = 65_536;

/** AES-GCM authentication tag length in bytes. */
export const TAG_LENGTH = 16;

/** Nonce (IV) length in bytes for AES-GCM. */
export const NONCE_LENGTH = 12;

/** Size of each encrypted record: plaintext + GCM tag. */
export const ENCRYPTED_RECORD_SIZE = RECORD_SIZE + TAG_LENGTH;

/** Maximum number of records (2^32 - limited by 32-bit XOR counter). */
const MAX_RECORDS = 0xffffffff;

/**
 * Create a TransformStream that encrypts plaintext chunks into ECE records.
 *
 * Input: arbitrary-sized Uint8Array chunks (will be internally buffered to RECORD_SIZE).
 * Output: Uint8Array chunks - first chunk is the 12-byte nonce header,
 *         followed by encrypted records of ENCRYPTED_RECORD_SIZE (last may be smaller).
 *
 * `baseNonce` is random per encryption. A client passes its own to put it into the metadata,
 * see `expectedBaseNonce()` in metadata.ts, so the recipient can check the header against it.
 *
 * Usage:
 *   readableStream.pipeThrough(createEncryptStream(fileKey, baseNonce))
 */
export function createEncryptStream(
  fileKey: CryptoKey,
  baseNonce: Uint8Array = randomBytes(NONCE_LENGTH),
): TransformStream<Uint8Array, Uint8Array> {
  if (baseNonce.length !== NONCE_LENGTH) {
    throw new Error(`Base nonce must be exactly ${NONCE_LENGTH} bytes`);
  }
  // A copy, so the record nonces do not change with the caller's array.
  baseNonce = baseNonce.slice();
  // The start of a record that the chunks so far did not fill. Whole records are encrypted
  // straight from the chunk they arrive in, so only this rest is ever copied. Copying the
  // remainder of every chunk once per record instead cost time quadratic in the chunk size,
  // and Chromium reads files in chunks of up to 2 MiB.
  const pending = new Uint8Array(RECORD_SIZE);
  let pendingLength = 0;
  let counter = 0;
  let headerSent = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      // Emit a copy of the nonce header before any encrypted data. The record nonces keep
      // coming from the stream's own array, whatever a consumer does with the chunk.
      if (!headerSent) {
        controller.enqueue(baseNonce.slice());
        headerSent = true;
      }

      let offset = 0;
      if (pendingLength > 0) {
        offset = Math.min(RECORD_SIZE - pendingLength, chunk.length);
        pending.set(chunk.subarray(0, offset), pendingLength);
        pendingLength += offset;
        if (pendingLength < RECORD_SIZE) return;
        await encryptAndEnqueue(pending, fileKey, baseNonce, counter++, controller);
        pendingLength = 0;
      }

      while (chunk.length - offset >= RECORD_SIZE) {
        const record = chunk.subarray(offset, offset + RECORD_SIZE);
        await encryptAndEnqueue(record, fileKey, baseNonce, counter++, controller);
        offset += RECORD_SIZE;
      }

      // Copied, so the stream holds no chunk of its producer once transform returns.
      pending.set(chunk.subarray(offset), 0);
      pendingLength = chunk.length - offset;
    },

    async flush(controller) {
      // Emit header even for empty input (edge case)
      if (!headerSent) {
        controller.enqueue(baseNonce.slice());
      }

      // Encrypt any remaining data as the final (potentially smaller) record
      if (pendingLength > 0) {
        const record = pending.subarray(0, pendingLength);
        await encryptAndEnqueue(record, fileKey, baseNonce, counter++, controller);
      }
    },
  });
}

/**
 * Create a TransformStream that decrypts an ECE stream back to plaintext.
 *
 * Input: Uint8Array chunks of the encrypted stream (nonce header + records).
 * Output: Decrypted plaintext Uint8Array chunks.
 *
 * Every record is authenticated on its own, so a stream cut at a record boundary
 * still decrypts cleanly. Only `expectedPlaintextSize` catches that, so every
 * download passes the size from the authenticated metadata, see
 * `expectedPlaintextSize()` in metadata.ts.
 *
 * The base nonce in the header is not authenticated either. With the header XORed by k, the
 * record at position i decrypts under the nonce of record i XOR k, so a server that moves
 * every record j to j XOR k gets a stream whose records all decrypt, in another order, at the
 * same size. `expectedBaseNonce`, from the authenticated metadata, closes that: a header that
 * differs from it fails before any record is decrypted. Undefined only for uploads of clients
 * that put no base nonce into the metadata.
 *
 * Usage:
 *   encryptedStream.pipeThrough(
 *     createDecryptStream(fileKey, expectedPlaintextSize(metadata), expectedBaseNonce(metadata)),
 *   )
 */
export function createDecryptStream(
  fileKey: CryptoKey,
  expectedPlaintextSize?: number,
  expectedBaseNonce?: Uint8Array,
): TransformStream<Uint8Array, Uint8Array> {
  if (expectedBaseNonce !== undefined && expectedBaseNonce.length !== NONCE_LENGTH) {
    throw new Error(`Base nonce must be exactly ${NONCE_LENGTH} bytes`);
  }
  let baseNonce: AnyBytes | null = null;
  const nonce = new Uint8Array(NONCE_LENGTH);
  let nonceLength = 0;
  // At most one record, waiting for the byte after it or for the end of the stream, the same
  // way createEncryptStream keeps the start of a record. Whole records are decrypted straight
  // from the chunk they arrive in, so a download that arrives in pieces of many MiB costs no
  // more than one in pieces of 64 KiB.
  const pending = new Uint8Array(ENCRYPTED_RECORD_SIZE);
  let pendingLength = 0;
  let counter = 0;
  let totalDecrypted = 0;

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      let offset = 0;

      // Phase 1: Read the nonce header
      if (baseNonce === null) {
        offset = Math.min(NONCE_LENGTH - nonceLength, chunk.length);
        nonce.set(chunk.subarray(0, offset), nonceLength);
        nonceLength += offset;
        if (nonceLength < NONCE_LENGTH) {
          return; // Need more data for nonce
        }
        if (expectedBaseNonce !== undefined && !constantTimeEqual(nonce, expectedBaseNonce)) {
          throw new Error("Decryption failed - data may be corrupted or tampered with");
        }
        baseNonce = nonce;
      }

      // Phase 2: Process encrypted records. A record is only decrypted once at least one byte
      // follows it, so the last one is always left for flush, which also checks what remains.
      if (pendingLength > 0) {
        const take = Math.min(ENCRYPTED_RECORD_SIZE - pendingLength, chunk.length - offset);
        pending.set(chunk.subarray(offset, offset + take), pendingLength);
        pendingLength += take;
        offset += take;
        if (pendingLength < ENCRYPTED_RECORD_SIZE || offset === chunk.length) return;
        totalDecrypted += RECORD_SIZE;
        await decryptAndEnqueue(pending, fileKey, baseNonce, counter++, controller);
        pendingLength = 0;
      }

      while (chunk.length - offset > ENCRYPTED_RECORD_SIZE) {
        const record = chunk.subarray(offset, offset + ENCRYPTED_RECORD_SIZE);
        totalDecrypted += RECORD_SIZE;
        await decryptAndEnqueue(record, fileKey, baseNonce, counter++, controller);
        offset += ENCRYPTED_RECORD_SIZE;
      }

      // Copied, so the stream holds no chunk of its producer once transform returns.
      pending.set(chunk.subarray(offset), 0);
      pendingLength = chunk.length - offset;
    },

    async flush(controller) {
      if (baseNonce === null) {
        throw new Error("Encrypted stream is empty - missing nonce header");
      }

      // Process the final record (may be smaller than ENCRYPTED_RECORD_SIZE)
      if (pendingLength > 0) {
        if (pendingLength <= TAG_LENGTH) {
          throw new Error("Invalid encrypted record: too short to contain auth tag");
        }
        totalDecrypted += pendingLength - TAG_LENGTH;
        const record = pending.subarray(0, pendingLength);
        await decryptAndEnqueue(record, fileKey, baseNonce, counter++, controller);
      }

      // Truncation check: verify the decrypted size matches the expected plaintext size.
      // This catches a malicious server delivering fewer records than were encrypted.
      if (expectedPlaintextSize !== undefined && totalDecrypted !== expectedPlaintextSize) {
        throw new Error(
          `Stream truncation detected: expected ${expectedPlaintextSize} bytes, got ${totalDecrypted} bytes`,
        );
      }
    },
  });
}

/** Encrypt a single plaintext record and enqueue it. */
async function encryptAndEnqueue(
  plaintext: AnyBytes,
  key: CryptoKey,
  baseNonce: AnyBytes,
  counter: number,
  controller: TransformStreamDefaultController<Uint8Array>,
): Promise<void> {
  // Reaching MAX_RECORDS requires ~281 TB of data (0xffffffff × 64 KB); not reachable in practice.
  /* v8 ignore next 2 */
  if (counter > MAX_RECORDS) {
    throw new Error("Maximum record count exceeded - stream too large");
  }

  const nonce = nonceXorCounter(asBytes(baseNonce), counter);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBytes(nonce), tagLength: TAG_LENGTH * 8 },
    key,
    asBytes(plaintext),
  );

  controller.enqueue(new Uint8Array(ciphertext));
}

/** Decrypt a single encrypted record and enqueue plaintext. */
async function decryptAndEnqueue(
  encrypted: AnyBytes,
  key: CryptoKey,
  baseNonce: AnyBytes,
  counter: number,
  controller: TransformStreamDefaultController<Uint8Array>,
): Promise<void> {
  // Reaching MAX_RECORDS requires ~281 TB of data (0xffffffff × 64 KB); not reachable in practice.
  /* v8 ignore next 2 */
  if (counter > MAX_RECORDS) {
    throw new Error("Maximum record count exceeded - stream too large");
  }

  const nonce = nonceXorCounter(asBytes(baseNonce), counter);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBytes(nonce), tagLength: TAG_LENGTH * 8 },
      key,
      asBytes(encrypted),
    );
    controller.enqueue(new Uint8Array(plaintext));
  } catch {
    throw new Error("Decryption failed - data may be corrupted or tampered with");
  }
}

/**
 * Calculate the encrypted size from plaintext size.
 * Useful for setting Content-Length headers.
 */
export function calculateEncryptedSize(plaintextSize: number): number {
  if (plaintextSize === 0) return NONCE_LENGTH;
  const fullRecords = Math.floor(plaintextSize / RECORD_SIZE);
  const lastRecordSize = plaintextSize % RECORD_SIZE;
  const recordCount = lastRecordSize > 0 ? fullRecords + 1 : fullRecords;
  return NONCE_LENGTH + recordCount * TAG_LENGTH + plaintextSize;
}

/**
 * Calculate the plaintext size from encrypted size.
 * Useful for reporting file sizes before decryption.
 */
export function calculatePlaintextSize(encryptedSize: number): number {
  if (encryptedSize <= NONCE_LENGTH) return 0;
  const dataSize = encryptedSize - NONCE_LENGTH;
  const fullRecords = Math.floor(dataSize / ENCRYPTED_RECORD_SIZE);
  const remainder = dataSize % ENCRYPTED_RECORD_SIZE;

  let plaintextSize = fullRecords * RECORD_SIZE;
  if (remainder > TAG_LENGTH) {
    plaintextSize += remainder - TAG_LENGTH;
  } else if (remainder > 0) {
    // Invalid - a partial record must be larger than just the tag
    throw new Error("Invalid encrypted size - partial record too short");
  }
  return plaintextSize;
}
