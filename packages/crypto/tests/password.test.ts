import { describe, expect, it } from "vitest";
import {
  deriveKeyFromPassword,
  deriveKeyFromPasswordArgon2,
  applyPasswordProtection,
  DERIVED_KEY_LENGTH,
  PASSWORD_SALT_LENGTH,
} from "../src/password.js";
import { constantTimeEqual, randomBytes } from "../src/util.js";

describe("deriveKeyFromPassword (auto-select)", () => {
  it("should throw when Argon2id WASM is unavailable", async () => {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    const wasmFailingArgon2id = async () => {
      throw new Error("WASM not supported");
    };
    await expect(
      deriveKeyFromPassword("test-password", salt, wasmFailingArgon2id),
    ).rejects.toThrow("WASM not supported");
  });

  it("should throw when Argon2id fails for any reason", async () => {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    const cryptoFailingArgon2id = async () => {
      throw new Error("unexpected internal error");
    };
    await expect(
      deriveKeyFromPassword("test-password", salt, cryptoFailingArgon2id),
    ).rejects.toThrow("unexpected internal error");
  });

  it("should use Argon2id when provided and working", async () => {
    const salt = randomBytes(PASSWORD_SALT_LENGTH);
    const mockArgon2id = async () => randomBytes(DERIVED_KEY_LENGTH);
    const result = await deriveKeyFromPassword("test-password", salt, mockArgon2id);
    expect(result.algorithm).toBe("argon2id-v2");
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
