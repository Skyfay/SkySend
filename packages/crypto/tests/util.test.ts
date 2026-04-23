import { describe, expect, it } from "vitest";
import {
  toBase64url,
  fromBase64url,
  concatBytes,
  encodeUtf8,
  decodeUtf8,
  constantTimeEqual,
  randomBytes,
  nonceXorCounter,
} from "../src/util.js";

describe("toBase64url / fromBase64url", () => {
  it("should round-trip empty data", () => {
    const data = new Uint8Array(0);
    const encoded = toBase64url(data);
    expect(encoded).toBe("");
    expect(fromBase64url(encoded)).toEqual(data);
  });

  it("should round-trip a single byte", () => {
    const data = new Uint8Array([0xff]);
    const encoded = toBase64url(data);
    const decoded = fromBase64url(encoded);
    expect(decoded).toEqual(data);
  });

  it("should round-trip known test vectors", () => {
    // RFC 4648 test vectors adapted for base64url
    const cases: [string, string][] = [
      ["", ""],
      ["f", "Zg"],
      ["fo", "Zm8"],
      ["foo", "Zm9v"],
      ["foob", "Zm9vYg"],
      ["fooba", "Zm9vYmE"],
      ["foobar", "Zm9vYmFy"],
    ];

    for (const [input, expected] of cases) {
      const data = encodeUtf8(input);
      expect(toBase64url(data)).toBe(expected);
      expect(decodeUtf8(fromBase64url(expected))).toBe(input);
    }
  });

  it("should round-trip random data of various lengths", () => {
    for (const len of [1, 2, 3, 15, 16, 31, 32, 33, 64, 100, 256]) {
      const data = randomBytes(len);
      const roundTripped = fromBase64url(toBase64url(data));
      expect(roundTripped).toEqual(data);
    }
  });

  it("should produce URL-safe output (no +, /, or =)", () => {
    const data = randomBytes(100);
    const encoded = toBase64url(data);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("should handle base64url with padding (tolerant decoding)", () => {
    const encoded = "Zm9vYmFy==";
    expect(decodeUtf8(fromBase64url(encoded))).toBe("foobar");
  });

  it("should handle a single-character input (length 1 mod 4 edge case)", () => {
    // Triggers the false branch of `i + 1 < input.length ? ... : 0` in fromBase64url.
    // A 1-char base64url string encodes less than one full byte; byteLength rounds to 0.
    const result = fromBase64url("A");
    expect(result).toEqual(new Uint8Array(0));
  });

  it("should throw on invalid characters", () => {
    expect(() => fromBase64url("abc!")).toThrow("Invalid base64url character");
  });
});

describe("concatBytes", () => {
  it("should concatenate empty arrays", () => {
    const result = concatBytes(new Uint8Array(0), new Uint8Array(0));
    expect(result).toEqual(new Uint8Array(0));
  });

  it("should concatenate multiple arrays", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const c = new Uint8Array([6]);
    expect(concatBytes(a, b, c)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it("should handle single array", () => {
    const a = new Uint8Array([1, 2, 3]);
    expect(concatBytes(a)).toEqual(a);
  });
});

describe("encodeUtf8 / decodeUtf8", () => {
  it("should round-trip ASCII", () => {
    const str = "hello world";
    expect(decodeUtf8(encodeUtf8(str))).toBe(str);
  });

  it("should round-trip Unicode", () => {
    const str = "Hello 🌍 - Umlaute: ä ö ü";
    expect(decodeUtf8(encodeUtf8(str))).toBe(str);
  });

  it("should round-trip empty string", () => {
    expect(decodeUtf8(encodeUtf8(""))).toBe("");
  });
});

describe("constantTimeEqual", () => {
  it("should return true for equal arrays", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it("should return false for different arrays", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it("should return false for different lengths", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it("should return true for empty arrays", () => {
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});

describe("randomBytes", () => {
  it("should produce the correct length", () => {
    expect(randomBytes(0).length).toBe(0);
    expect(randomBytes(16).length).toBe(16);
    expect(randomBytes(32).length).toBe(32);
    expect(randomBytes(64).length).toBe(64);
  });

  it("should produce different values on each call", () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    // Probability of collision is astronomically low (2^-256)
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});

describe("nonceXorCounter", () => {
  it("should XOR counter into last 4 bytes", () => {
    const nonce = new Uint8Array(12).fill(0);
    const result = nonceXorCounter(nonce, 1);
    expect(result[11]).toBe(1);
    expect(result[10]).toBe(0);
    expect(result[9]).toBe(0);
    expect(result[8]).toBe(0);
  });

  it("should handle large counter values", () => {
    const nonce = new Uint8Array(12).fill(0);
    const result = nonceXorCounter(nonce, 0x01020304);
    expect(result[8]).toBe(0x01);
    expect(result[9]).toBe(0x02);
    expect(result[10]).toBe(0x03);
    expect(result[11]).toBe(0x04);
  });

  it("should XOR, not replace, the bytes", () => {
    const nonce = new Uint8Array(12).fill(0xff);
    const result = nonceXorCounter(nonce, 1);
    expect(result[11]).toBe(0xfe); // 0xff ^ 0x01
    expect(result[10]).toBe(0xff); // 0xff ^ 0x00
  });

  it("should not modify the original nonce", () => {
    const nonce = new Uint8Array(12).fill(0);
    nonceXorCounter(nonce, 42);
    expect(nonce[11]).toBe(0);
  });

  it("should throw for non-12-byte nonce", () => {
    expect(() => nonceXorCounter(new Uint8Array(11), 0)).toThrow("12 bytes");
    expect(() => nonceXorCounter(new Uint8Array(13), 0)).toThrow("12 bytes");
  });

  it("should throw for invalid counter", () => {
    const nonce = new Uint8Array(12);
    expect(() => nonceXorCounter(nonce, -1)).toThrow("32-bit unsigned integer");
    expect(() => nonceXorCounter(nonce, 0x100000000)).toThrow("32-bit unsigned integer");
  });

  it("should produce unique nonces for different counters", () => {
    const nonce = randomBytes(12);
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      results.add(toBase64url(nonceXorCounter(nonce, i)));
    }
    expect(results.size).toBe(100);
  });
});
