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

import { asBytes, nonceXorCounter, randomBytes } from "./util.js";

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
 * Usage:
 *   readableStream.pipeThrough(createEncryptStream(fileKey))
 */
export function createEncryptStream(
  fileKey: CryptoKey,
): TransformStream<Uint8Array, Uint8Array> {
  const baseNonce = randomBytes(NONCE_LENGTH);
  let buffer: AnyBytes = new Uint8Array(0);
  let counter = 0;
  let headerSent = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      // Emit the nonce header before any encrypted data
      if (!headerSent) {
        controller.enqueue(baseNonce);
        headerSent = true;
      }

      // Append incoming data to buffer
      buffer = appendToBuffer(buffer, chunk);

      // Process all complete records
      while (buffer.length >= RECORD_SIZE) {
        const record = buffer.slice(0, RECORD_SIZE);
        buffer = buffer.slice(RECORD_SIZE);
        await encryptAndEnqueue(record, fileKey, baseNonce, counter++, controller);
      }
    },

    async flush(controller) {
      // Emit header even for empty input (edge case)
      if (!headerSent) {
        controller.enqueue(baseNonce);
      }

      // Encrypt any remaining data as the final (potentially smaller) record
      if (buffer.length > 0) {
        await encryptAndEnqueue(buffer, fileKey, baseNonce, counter++, controller);
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
 * Usage:
 *   encryptedStream.pipeThrough(createDecryptStream(fileKey))
 */
export function createDecryptStream(
  fileKey: CryptoKey,
): TransformStream<Uint8Array, Uint8Array> {
  let baseNonce: AnyBytes | null = null;
  let buffer: AnyBytes = new Uint8Array(0);
  let counter = 0;
  let nonceBuffer: AnyBytes = new Uint8Array(0);

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      // Phase 1: Read the nonce header
      if (baseNonce === null) {
        nonceBuffer = appendToBuffer(nonceBuffer, chunk);
        if (nonceBuffer.length < NONCE_LENGTH) {
          return; // Need more data for nonce
        }
        baseNonce = nonceBuffer.slice(0, NONCE_LENGTH);
        // Remaining bytes after nonce go into the record buffer
        const remaining = nonceBuffer.slice(NONCE_LENGTH);
        nonceBuffer = new Uint8Array(0); // Free memory
        if (remaining.length === 0) return;
        chunk = remaining;
      }

      // Phase 2: Buffer and process encrypted records
      buffer = appendToBuffer(buffer, chunk);

      // Process all complete records. We keep at least one byte beyond
      // ENCRYPTED_RECORD_SIZE in the buffer before processing, because
      // we need to know if this is the last record (for proper GCM handling).
      // However, since GCM doesn't need special last-record treatment
      // in our design, we process all complete records immediately.
      while (buffer.length > ENCRYPTED_RECORD_SIZE) {
        const record = buffer.slice(0, ENCRYPTED_RECORD_SIZE);
        buffer = buffer.slice(ENCRYPTED_RECORD_SIZE);
        await decryptAndEnqueue(record, fileKey, baseNonce, counter++, controller);
      }
    },

    async flush(controller) {
      if (baseNonce === null) {
        throw new Error("Encrypted stream is empty - missing nonce header");
      }

      // Process the final record (may be smaller than ENCRYPTED_RECORD_SIZE)
      if (buffer.length > 0) {
        if (buffer.length <= TAG_LENGTH) {
          throw new Error("Invalid encrypted record: too short to contain auth tag");
        }
        await decryptAndEnqueue(buffer, fileKey, baseNonce, counter++, controller);
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

/** Append new data to an existing buffer. */
function appendToBuffer(existing: AnyBytes, newData: AnyBytes): AnyBytes {
  if (existing.length === 0) return newData;
  const combined = new Uint8Array(existing.length + newData.length);
  combined.set(existing, 0);
  combined.set(newData, existing.length);
  return combined;
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
