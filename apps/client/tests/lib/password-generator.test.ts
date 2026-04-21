import { describe, expect, it } from "vitest";
import { generatePassword } from "../../src/lib/password-generator.js";

// Character set definitions (must match the implementation)
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{}|;:,.<>?/~";

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
    expect(a).not.toBe(b);
  });
});
