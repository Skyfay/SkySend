import { describe, expect, it } from "vitest";
import { generatePassword, calculateEntropy } from "../../src/lib/password-generator.js";

// Character set definitions (must match the implementation)
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{}|;:,.<>?/~";

// ── generatePassword ──────────────────────────────────────────────────────────

describe("generatePassword", () => {
  it("returns empty string when no character sets are enabled", () => {
    expect(
      generatePassword({ length: 16, uppercase: false, lowercase: false, numbers: false, symbols: false }),
    ).toBe("");
  });

  it("generates a password of exactly the requested length", () => {
    const lengths = [8, 12, 16, 32, 64];
    for (const length of lengths) {
      const pw = generatePassword({ length, uppercase: true, lowercase: true, numbers: true, symbols: false });
      expect(pw).toHaveLength(length);
    }
  });

  it("generates uppercase-only passwords", () => {
    const pw = generatePassword({ length: 50, uppercase: true, lowercase: false, numbers: false, symbols: false });
    expect(pw).toHaveLength(50);
    expect([...pw].every((c) => UPPERCASE.includes(c))).toBe(true);
  });

  it("generates lowercase-only passwords", () => {
    const pw = generatePassword({ length: 50, uppercase: false, lowercase: true, numbers: false, symbols: false });
    expect(pw).toHaveLength(50);
    expect([...pw].every((c) => LOWERCASE.includes(c))).toBe(true);
  });

  it("generates numbers-only passwords", () => {
    const pw = generatePassword({ length: 50, uppercase: false, lowercase: false, numbers: true, symbols: false });
    expect(pw).toHaveLength(50);
    expect([...pw].every((c) => NUMBERS.includes(c))).toBe(true);
  });

  it("generates symbols-only passwords", () => {
    const pw = generatePassword({ length: 50, uppercase: false, lowercase: false, numbers: false, symbols: true });
    expect(pw).toHaveLength(50);
    expect([...pw].every((c) => SYMBOLS.includes(c))).toBe(true);
  });

  it("generates passwords only from the selected character sets", () => {
    const pw = generatePassword({ length: 100, uppercase: true, lowercase: false, numbers: true, symbols: false });
    const allowed = UPPERCASE + NUMBERS;
    expect([...pw].every((c) => allowed.includes(c))).toBe(true);
  });

  it("produces different passwords on successive calls (randomness sanity check)", () => {
    const a = generatePassword({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true });
    const b = generatePassword({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true });
    // Astronomically unlikely to be equal; if this flakes, there's a real bug
    expect(a).not.toBe(b);
  });

  it("generates a password with all character sets enabled", () => {
    const pw = generatePassword({ length: 100, uppercase: true, lowercase: true, numbers: true, symbols: true });
    const allowed = UPPERCASE + LOWERCASE + NUMBERS + SYMBOLS;
    expect(pw).toHaveLength(100);
    expect([...pw].every((c) => allowed.includes(c))).toBe(true);
  });
});

// ── calculateEntropy ──────────────────────────────────────────────────────────

describe("calculateEntropy", () => {
  it("returns 0 for no character sets enabled", () => {
    expect(
      calculateEntropy({ length: 16, uppercase: false, lowercase: false, numbers: false, symbols: false }),
    ).toBe(0);
  });

  it("calculates entropy for uppercase only (pool=26)", () => {
    // floor(10 * log2(26)) = floor(10 * 4.7004) = 47
    expect(
      calculateEntropy({ length: 10, uppercase: true, lowercase: false, numbers: false, symbols: false }),
    ).toBe(47);
  });

  it("calculates entropy for numbers only (pool=10)", () => {
    // floor(10 * log2(10)) = floor(33.219) = 33
    expect(
      calculateEntropy({ length: 10, uppercase: false, lowercase: false, numbers: true, symbols: false }),
    ).toBe(33);
  });

  it("calculates entropy for symbols only (pool=28)", () => {
    // floor(10 * log2(28)) = floor(48.07) = 48
    expect(
      calculateEntropy({ length: 10, uppercase: false, lowercase: false, numbers: false, symbols: true }),
    ).toBe(48);
  });

  it("calculates entropy for all character sets combined (pool=90)", () => {
    // pool = 26+26+10+28 = 90, floor(16 * log2(90)) = floor(103.87) = 103
    expect(
      calculateEntropy({ length: 16, uppercase: true, lowercase: true, numbers: true, symbols: true }),
    ).toBe(103);
  });

  it("entropy grows with password length (not necessarily exactly linear due to floor)", () => {
    const opts = { uppercase: true, lowercase: true, numbers: false, symbols: false };
    const e8 = calculateEntropy({ ...opts, length: 8 });
    const e16 = calculateEntropy({ ...opts, length: 16 });
    const e32 = calculateEntropy({ ...opts, length: 32 });
    expect(e16).toBeGreaterThan(e8);
    expect(e32).toBeGreaterThan(e16);
  });
});
