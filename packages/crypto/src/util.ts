/**
 * Encoding helpers for the SkySend crypto library.
 * Uses only standard Web APIs - no external dependencies.
 */

/**
 * TypeScript 6 made Uint8Array generic over its buffer type.
 * Bare `Uint8Array` defaults to `Uint8Array<ArrayBufferLike>` in TS 6.
 * Web Crypto API requires `Uint8Array<ArrayBuffer>` (non-shared).
 * This cast is safe because we never use SharedArrayBuffer in this codebase.
 */
export function asBytes(data: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  return data as Uint8Array<ArrayBuffer>;
}

const BASE64URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Encode a Uint8Array to a base64url string (no padding).
 * RFC 4648 Section 5.
 */
export function toBase64url(data: Uint8Array): string {
  let result = "";
  const len = data.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = data[i]!;
    const b1 = i + 1 < len ? data[i + 1]! : 0;
    const b2 = i + 2 < len ? data[i + 2]! : 0;

    result += BASE64URL_CHARS[(b0 >> 2)!]!;
    result += BASE64URL_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    if (i + 1 < len) {
      result += BASE64URL_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)]!;
    }
    if (i + 2 < len) {
      result += BASE64URL_CHARS[b2 & 0x3f]!;
    }
  }
  return result;
}

/**
 * Decode a base64url string (with or without padding) to a Uint8Array.
 * RFC 4648 Section 5.
 */
export function fromBase64url(str: string): Uint8Array {
  // Remove any padding
  const input = str.replace(/=+$/, "");

  const byteLength = Math.floor((input.length * 3) / 4);
  const bytes = new Uint8Array(byteLength);

  let byteIndex = 0;
  for (let i = 0; i < input.length; i += 4) {
    const a = decodeBase64urlChar(input[i]!);
    const b = i + 1 < input.length ? decodeBase64urlChar(input[i + 1]!) : 0;
    const c = i + 2 < input.length ? decodeBase64urlChar(input[i + 2]!) : 0;
    const d = i + 3 < input.length ? decodeBase64urlChar(input[i + 3]!) : 0;

    bytes[byteIndex++] = (a << 2) | (b >> 4);
    if (i + 2 < input.length) {
      bytes[byteIndex++] = ((b & 0x0f) << 4) | (c >> 2);
    }
    if (i + 3 < input.length) {
      bytes[byteIndex++] = ((c & 0x03) << 6) | d;
    }
  }

  return bytes;
}

function decodeBase64urlChar(char: string): number {
  const code = char.charCodeAt(0);
  // A-Z
  if (code >= 65 && code <= 90) return code - 65;
  // a-z
  if (code >= 97 && code <= 122) return code - 71;
  // 0-9
  if (code >= 48 && code <= 57) return code + 4;
  // -
  if (code === 45) return 62;
  // _
  if (code === 95) return 63;
  throw new Error(`Invalid base64url character: ${char}`);
}

/** Concatenate multiple Uint8Arrays into one. */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const arr of arrays) {
    totalLength += arr.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/** Encode a UTF-8 string to Uint8Array. */
export function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Decode a Uint8Array to a UTF-8 string. */
export function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

/** Compare two Uint8Arrays in constant time to prevent timing attacks. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/** Generate cryptographically secure random bytes. */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  // crypto.getRandomValues() has a 65,536 byte limit per call
  const maxChunk = 65_536;
  for (let offset = 0; offset < length; offset += maxChunk) {
    const size = Math.min(maxChunk, length - offset);
    crypto.getRandomValues(bytes.subarray(offset, offset + size));
  }
  return bytes;
}

/** XOR a 12-byte nonce with a counter value to produce a unique nonce per chunk. */
export function nonceXorCounter(baseNonce: Uint8Array, counter: number): Uint8Array {
  if (baseNonce.length !== 12) {
    throw new Error("Base nonce must be 12 bytes");
  }
  if (counter < 0 || counter > 0xffffffff) {
    throw new Error("Counter must be a 32-bit unsigned integer");
  }

  const nonce = new Uint8Array(baseNonce);
  // XOR counter into the last 4 bytes (big-endian)
  nonce[8]! ^= (counter >>> 24) & 0xff;
  nonce[9]! ^= (counter >>> 16) & 0xff;
  nonce[10]! ^= (counter >>> 8) & 0xff;
  nonce[11]! ^= counter & 0xff;
  return nonce;
}
