import { describe, expect, it } from "vitest";
import {
  generateSecret,
  generateSalt,
  deriveKeys,
  computeAuthToken,
  computeOwnerToken,
  SECRET_LENGTH,
  SALT_LENGTH,
  TOKEN_LENGTH,
} from "../src/keychain.js";
import { constantTimeEqual } from "../src/util.js";
import { fromHex, toHex } from "./helpers.js";

describe("generateSecret", () => {
  it("should produce a 32-byte secret", () => {
    const secret = generateSecret();
    expect(secret.length).toBe(SECRET_LENGTH);
    expect(secret).toBeInstanceOf(Uint8Array);
  });

  it("should produce unique secrets", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});

describe("generateSalt", () => {
  it("should produce a 32-byte salt", () => {
    const salt = generateSalt();
    expect(salt.length).toBe(SALT_LENGTH);
  });

  it("should produce unique salts", () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});

describe("deriveKeys", () => {
  it("should derive three distinct keys", async () => {
    const secret = generateSecret();
    const salt = generateSalt();
    const keys = await deriveKeys(secret, salt);

    expect(keys.fileKey).toBeDefined();
    expect(keys.metaKey).toBeDefined();
    expect(keys.authKey).toBeDefined();

    // Keys should be CryptoKey instances
    expect(keys.fileKey.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(keys.metaKey.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(keys.authKey.algorithm).toMatchObject({ name: "HMAC" });
  });

  it("should produce deterministic keys for same secret + salt", async () => {
    const secret = generateSecret();
    const salt = generateSalt();

    const keys1 = await deriveKeys(secret, salt);
    const keys2 = await deriveKeys(secret, salt);

    // Encrypt the same data with both fileKeys - should produce same result
    // (with the same IV)
    const iv = new Uint8Array(12);
    const data = new Uint8Array([1, 2, 3, 4]);

    const ct1 = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys1.fileKey, data),
    );
    const ct2 = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys2.fileKey, data),
    );

    expect(constantTimeEqual(ct1, ct2)).toBe(true);
  });

  it("should produce different keys for different secrets", async () => {
    const salt = generateSalt();
    const keys1 = await deriveKeys(generateSecret(), salt);
    const keys2 = await deriveKeys(generateSecret(), salt);

    const iv = new Uint8Array(12);
    const data = new Uint8Array([1, 2, 3, 4]);

    const ct1 = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys1.fileKey, data),
    );
    const ct2 = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys2.fileKey, data),
    );

    expect(constantTimeEqual(ct1, ct2)).toBe(false);
  });

  it("should produce different keys for different salts", async () => {
    const secret = generateSecret();
    const keys1 = await deriveKeys(secret, generateSalt());
    const keys2 = await deriveKeys(secret, generateSalt());

    const iv = new Uint8Array(12);
    const data = new Uint8Array([1, 2, 3, 4]);

    const ct1 = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys1.fileKey, data),
    );
    const ct2 = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys2.fileKey, data),
    );

    expect(constantTimeEqual(ct1, ct2)).toBe(false);
  });

  it("should reject wrong secret length", async () => {
    const salt = generateSalt();
    await expect(deriveKeys(new Uint8Array(16), salt)).rejects.toThrow("32 bytes");
  });

  it("should reject wrong salt length", async () => {
    const secret = generateSecret();
    await expect(deriveKeys(secret, new Uint8Array(8))).rejects.toThrow("16 or 32 bytes");
  });

  it("should accept legacy 16-byte salt for backward compatibility", async () => {
    const secret = generateSecret();
    const legacySalt = new Uint8Array(16);
    crypto.getRandomValues(legacySalt);
    // Must not throw - old uploads use 16-byte salts
    await expect(deriveKeys(secret, legacySalt)).resolves.toBeDefined();
  });

  it("should mark all keys as non-extractable", async () => {
    const keys = await deriveKeys(generateSecret(), generateSalt());
    expect(keys.fileKey.extractable).toBe(false);
    expect(keys.metaKey.extractable).toBe(false);
    expect(keys.authKey.extractable).toBe(false);
  });

  it("should derive domain-separated keys (fileKey and metaKey produce different ciphertext for same input)", async () => {
    const keys = await deriveKeys(generateSecret(), generateSalt());
    const iv = new Uint8Array(12); // fixed IV so only the key differs
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const ct1 = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys.fileKey, data),
    );
    const ct2 = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys.metaKey, data),
    );

    // Different HKDF info strings must produce independent keys
    expect(constantTimeEqual(ct1, ct2)).toBe(false);
  });
});

describe("computeAuthToken", () => {
  it("should produce a 32-byte token", async () => {
    const keys = await deriveKeys(generateSecret(), generateSalt());
    const token = await computeAuthToken(keys.authKey);
    expect(token.length).toBe(32);
  });

  it("should be deterministic for same key", async () => {
    const keys = await deriveKeys(generateSecret(), generateSalt());
    const token1 = await computeAuthToken(keys.authKey);
    const token2 = await computeAuthToken(keys.authKey);
    expect(constantTimeEqual(token1, token2)).toBe(true);
  });

  it("should differ for different keys", async () => {
    const keys1 = await deriveKeys(generateSecret(), generateSalt());
    const keys2 = await deriveKeys(generateSecret(), generateSalt());
    const token1 = await computeAuthToken(keys1.authKey);
    const token2 = await computeAuthToken(keys2.authKey);
    expect(constantTimeEqual(token1, token2)).toBe(false);
  });
});

describe("computeOwnerToken", () => {
  it("should produce a 32-byte token", async () => {
    const secret = generateSecret();
    const salt = generateSalt();
    const token = await computeOwnerToken(secret, salt);
    expect(token.length).toBe(32);
  });

  it("should be deterministic for same inputs", async () => {
    const secret = generateSecret();
    const salt = generateSalt();
    const token1 = await computeOwnerToken(secret, salt);
    const token2 = await computeOwnerToken(secret, salt);
    expect(constantTimeEqual(token1, token2)).toBe(true);
  });

  it("should differ from auth token", async () => {
    const secret = generateSecret();
    const salt = generateSalt();
    const keys = await deriveKeys(secret, salt);
    const ownerToken = await computeOwnerToken(secret, salt);
    const authToken = await computeAuthToken(keys.authKey);
    expect(constantTimeEqual(ownerToken, authToken)).toBe(false);
  });

  it("should reject wrong secret length", async () => {
    await expect(computeOwnerToken(new Uint8Array(16), generateSalt())).rejects.toThrow(
      "32 bytes",
    );
  });

  it("should differ for different salts (same secret)", async () => {
    const secret = generateSecret();
    const token1 = await computeOwnerToken(secret, generateSalt());
    const token2 = await computeOwnerToken(secret, generateSalt());
    expect(constantTimeEqual(token1, token2)).toBe(false);
  });

  it("should accept the salts deriveKeys accepts, 32 and legacy 16 bytes", async () => {
    const secret = generateSecret();
    expect((await computeOwnerToken(secret, new Uint8Array(32))).length).toBe(TOKEN_LENGTH);
    expect((await computeOwnerToken(secret, new Uint8Array(16))).length).toBe(TOKEN_LENGTH);
  });

  it.each([0, 15, 17, 31, 33])("should reject a %i-byte salt", async (length) => {
    await expect(computeOwnerToken(generateSecret(), new Uint8Array(length))).rejects.toThrow(
      "Salt must be 16 or 32 bytes",
    );
  });
});

describe("frozen token derivation", () => {
  // Fixed inputs with their tokens, checked against an independent HKDF and HMAC implementation
  // (node:crypto) on 2026-10-10. The server stores these tokens for the lifetime of a share, so
  // a change here means every existing link stops opening. Never update the expected values.
  const secret = fromHex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
  const cases = [
    {
      name: "32-byte salt",
      salt: fromHex("202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"),
      authToken: "9b0cd78bf19921f4d0aab6eb474dca89a2e98616b2be1b134e8745b8482dfb9c",
      ownerToken: "044e61770e5bf550bdc775306218d016d6c91eb29ddfea45811371dd537f4e18",
    },
    {
      name: "legacy 16-byte salt",
      salt: fromHex("404142434445464748494a4b4c4d4e4f"),
      authToken: "d9bb1efa83f5201bebf6f231a566b2c32c6f015ec4b96aec823dbb93f6cdab9f",
      ownerToken: "73cd5b15611d82727b1b1975cbca4ab3109496ca4e86b708074d4302e3bc1c9e",
    },
  ];

  it.each(cases)(
    "should derive the frozen tokens for a $name",
    async ({ salt, authToken, ownerToken }) => {
      const keys = await deriveKeys(secret, salt);
      expect(toHex(await computeAuthToken(keys.authKey))).toBe(authToken);
      expect(toHex(await computeOwnerToken(secret, salt))).toBe(ownerToken);
    },
  );

  it("should keep the token length the server checks at 32 bytes", () => {
    expect(TOKEN_LENGTH).toBe(32);
  });
});
