import { describe, expect, it } from "vitest";
import {
  encryptMetadata,
  decryptMetadata,
  META_IV_LENGTH,
} from "../src/metadata.js";
import type { FileMetadata, SingleFileMetadata, ArchiveMetadata } from "../src/metadata.js";
import { deriveKeys, generateSecret, generateSalt } from "../src/keychain.js";

async function getMetaKey(): Promise<CryptoKey> {
  const keys = await deriveKeys(generateSecret(), generateSalt());
  return keys.metaKey;
}

describe("metadata encryption/decryption", () => {
  it("should round-trip single file metadata", async () => {
    const metaKey = await getMetaKey();
    const metadata: SingleFileMetadata = {
      type: "single",
      name: "document.pdf",
      size: 1_234_567,
      mimeType: "application/pdf",
    };

    const encrypted = await encryptMetadata(metadata, metaKey);
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    expect(encrypted.iv.length).toBe(META_IV_LENGTH);

    const decrypted = await decryptMetadata(encrypted.ciphertext, encrypted.iv, metaKey);
    expect(decrypted).toEqual(metadata);
  });

  it("should round-trip archive metadata", async () => {
    const metaKey = await getMetaKey();
    const metadata: ArchiveMetadata = {
      type: "archive",
      files: [
        { name: "photo1.jpg", size: 500_000 },
        { name: "photo2.jpg", size: 600_000 },
        { name: "notes.txt", size: 1_234 },
      ],
      totalSize: 1_101_234,
    };

    const encrypted = await encryptMetadata(metadata, metaKey);
    const decrypted = await decryptMetadata(encrypted.ciphertext, encrypted.iv, metaKey);
    expect(decrypted).toEqual(metadata);
  });

  it("should handle Unicode file names", async () => {
    const metaKey = await getMetaKey();
    const metadata: SingleFileMetadata = {
      type: "single",
      name: "Bericht - Zusammenfassung.pdf",
      size: 42,
      mimeType: "application/pdf",
    };

    const encrypted = await encryptMetadata(metadata, metaKey);
    const decrypted = await decryptMetadata(encrypted.ciphertext, encrypted.iv, metaKey);
    expect(decrypted).toEqual(metadata);
  });

  it("should produce different ciphertext each time (random IV)", async () => {
    const metaKey = await getMetaKey();
    const metadata: FileMetadata = {
      type: "single",
      name: "test.txt",
      size: 100,
      mimeType: "text/plain",
    };

    const enc1 = await encryptMetadata(metadata, metaKey);
    const enc2 = await encryptMetadata(metadata, metaKey);

    // IVs should be different
    expect(enc1.iv).not.toEqual(enc2.iv);
    // Ciphertext should be different
    expect(enc1.ciphertext).not.toEqual(enc2.ciphertext);
  });

  it("should fail decryption with wrong key", async () => {
    const metaKey1 = await getMetaKey();
    const metaKey2 = await getMetaKey();
    const metadata: FileMetadata = {
      type: "single",
      name: "test.txt",
      size: 100,
      mimeType: "text/plain",
    };

    const encrypted = await encryptMetadata(metadata, metaKey1);
    await expect(
      decryptMetadata(encrypted.ciphertext, encrypted.iv, metaKey2),
    ).rejects.toThrow("corrupted or tampered");
  });

  it("should fail decryption with wrong IV", async () => {
    const metaKey = await getMetaKey();
    const metadata: FileMetadata = {
      type: "single",
      name: "test.txt",
      size: 100,
      mimeType: "text/plain",
    };

    const encrypted = await encryptMetadata(metadata, metaKey);
    const wrongIv = new Uint8Array(META_IV_LENGTH).fill(0);
    await expect(
      decryptMetadata(encrypted.ciphertext, wrongIv, metaKey),
    ).rejects.toThrow("corrupted or tampered");
  });

  it("should fail with tampered ciphertext", async () => {
    const metaKey = await getMetaKey();
    const metadata: FileMetadata = {
      type: "single",
      name: "test.txt",
      size: 100,
      mimeType: "text/plain",
    };

    const encrypted = await encryptMetadata(metadata, metaKey);
    const tampered = new Uint8Array(encrypted.ciphertext);
    tampered[0] ^= 0xff;
    await expect(
      decryptMetadata(tampered, encrypted.iv, metaKey),
    ).rejects.toThrow("corrupted or tampered");
  });

  it("should reject wrong IV length", async () => {
    const metaKey = await getMetaKey();
    await expect(
      decryptMetadata(new Uint8Array(32), new Uint8Array(8), metaKey),
    ).rejects.toThrow("12 bytes");
  });

  it("should strip extra fields from metadata (no prototype pollution)", async () => {
    const metaKey = await getMetaKey();
    // Manually construct metadata with extra fields
    const raw = {
      type: "single" as const,
      name: "test.txt",
      size: 100,
      mimeType: "text/plain",
      __proto__: { isAdmin: true },
      constructor: "evil",
    };

    const encrypted = await encryptMetadata(raw, metaKey);
    const decrypted = await decryptMetadata(encrypted.ciphertext, encrypted.iv, metaKey);

    // Should only contain the validated fields
    expect(decrypted).toEqual({
      type: "single",
      name: "test.txt",
      size: 100,
      mimeType: "text/plain",
    });
    expect(Object.keys(decrypted).sort()).toEqual(["mimeType", "name", "size", "type"]);
  });
});
