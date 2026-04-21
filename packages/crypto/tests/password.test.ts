import { describe, expect, it } from "vitest";
import {
  deriveKeyFromPasswordPbkdf2,
  deriveKeyFromPassword,
  deriveKeyFromPasswordArgon2,
  applyPasswordProtection,
  DERIVED_KEY_LENGTH,
  PASSWORD_SALT_LENGTH,
} from "../src/password.js";
import { constantTimeEqual, randomBytes } from "../src/util.js";

describe("deriveKeyFromPasswordPbkdf2", () => {
  it("should derive a 32-byte key", async () => {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    const key = await deriveKeyFromPasswordPbkdf2("test-password", salt);
    expect(key.length).toBe(DERIVED_KEY_LENGTH);
    expect(key).toBeInstanceOf(Uint8Array);
  });

  it("should be deterministic for same password + salt", async () => {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    const key1 = await deriveKeyFromPasswordPbkdf2("my-password", salt);
    const key2 = await deriveKeyFromPasswordPbkdf2("my-password", salt);
    expect(constantTimeEqual(key1, key2)).toBe(true);
  });

  it("should produce different keys for different passwords", async () => {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    const key1 = await deriveKeyFromPasswordPbkdf2("password-1", salt);
    const key2 = await deriveKeyFromPasswordPbkdf2("password-2", salt);
    expect(constantTimeEqual(key1, key2)).toBe(false);
  });

  it("should produce different keys for different salts", async () => {
    const salt1 = randomBytes(PASSWORD_SALT_LENGTH);
    const salt2 = randomBytes(PASSWORD_SALT_LENGTH);
    const key1 = await deriveKeyFromPasswordPbkdf2("same-password", salt1);
    const key2 = await deriveKeyFromPasswordPbkdf2("same-password", salt2);
    expect(constantTimeEqual(key1, key2)).toBe(false);
  });

  it("should reject empty password", async () => {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    await expect(deriveKeyFromPasswordPbkdf2("", salt)).rejects.toThrow("not be empty");
  });

  it("should reject wrong salt length", async () => {
    await expect(
      deriveKeyFromPasswordPbkdf2("password", new Uint8Array(8)),
    ).rejects.toThrow("16 bytes");
  });

  it("should handle Unicode passwords", async () => {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    const key = await deriveKeyFromPasswordPbkdf2("passwort-mit-umlauten-aou", salt);
    expect(key.length).toBe(DERIVED_KEY_LENGTH);
  });
});

describe("deriveKeyFromPassword (auto-select)", () => {
  it("should fall back to PBKDF2 when no Argon2id is provided", async () => {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    const result = await deriveKeyFromPassword("test-password", salt);
    expect(result.algorithm).toBe("pbkdf2");
    expect(result.key.length).toBe(DERIVED_KEY_LENGTH);
  });

  it("should fall back to PBKDF2 when Argon2id function fails", async () => {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    const failingArgon2id = async () => {
      throw new Error("WASM not supported");
    };
    const result = await deriveKeyFromPassword("test-password", salt, failingArgon2id);
    expect(result.algorithm).toBe("pbkdf2");
    expect(result.key.length).toBe(DERIVED_KEY_LENGTH);
  });

  it("should use Argon2id when provided and working", async () => {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    const mockArgon2id = async () => randomBytes(DERIVED_KEY_LENGTH);
    const result = await deriveKeyFromPassword("test-password", salt, mockArgon2id);
    expect(result.algorithm).toBe("argon2id");
    expect(result.key.length).toBe(DERIVED_KEY_LENGTH);
  });
});

describe("applyPasswordProtection", () => {
  it("should produce a different value than the input", () => {
    const secret = randomBytes(DERIVED_KEY_LENGTH);
    const passwordKey = randomBytes(DERIVED_KEY_LENGTH);
    const protected_ = applyPasswordProtection(secret, passwordKey);
    expect(constantTimeEqual(protected_, secret)).toBe(false);
  });

  it("should be reversible (XOR is its own inverse)", () => {
    const secret = randomBytes(DERIVED_KEY_LENGTH);
    const passwordKey = randomBytes(DERIVED_KEY_LENGTH);
    const protected_ = applyPasswordProtection(secret, passwordKey);
    const recovered = applyPasswordProtection(protected_, passwordKey);
    expect(constantTimeEqual(recovered, secret)).toBe(true);
  });

  it("should reject wrong secret length", () => {
    expect(() =>
      applyPasswordProtection(new Uint8Array(16), randomBytes(DERIVED_KEY_LENGTH)),
    ).toThrow("32 bytes");
  });

  it("should reject wrong password key length", () => {
    expect(() =>
      applyPasswordProtection(randomBytes(DERIVED_KEY_LENGTH), new Uint8Array(16)),
    ).toThrow("32 bytes");
  });

  it("should XOR with zero key returning the same value", () => {
    const secret = randomBytes(DERIVED_KEY_LENGTH);
    const zeroKey = new Uint8Array(DERIVED_KEY_LENGTH);
    const result = applyPasswordProtection(secret, zeroKey);
    expect(constantTimeEqual(result, secret)).toBe(true);
  });
});

describe("deriveKeyFromPasswordArgon2", () => {
  it("should reject wrong salt length", async () => {
    const mockArgon2id = async () => randomBytes(DERIVED_KEY_LENGTH);
    await expect(
      deriveKeyFromPasswordArgon2("password", new Uint8Array(8), mockArgon2id),
    ).rejects.toThrow("16 bytes");
  });

  it("should reject empty password", async () => {
    const mockArgon2id = async () => randomBytes(DERIVED_KEY_LENGTH);
    await expect(
      deriveKeyFromPasswordArgon2("", randomBytes(PASSWORD_SALT_LENGTH), mockArgon2id),
    ).rejects.toThrow("not be empty");
  });

  it("should return the key from the argon2id function", async () => {
    const expectedKey = randomBytes(DERIVED_KEY_LENGTH);
    const mockArgon2id = async () => expectedKey;
    const result = await deriveKeyFromPasswordArgon2(
      "my-password",
      randomBytes(PASSWORD_SALT_LENGTH),
      mockArgon2id,
    );
    expect(constantTimeEqual(result, expectedKey)).toBe(true);
  });
});
