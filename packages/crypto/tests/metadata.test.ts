import { describe, expect, it } from "vitest";
import {
  encryptMetadata,
  decryptMetadata,
  META_IV_LENGTH,
} from "../src/metadata.js";
import type { FileMetadata, SingleFileMetadata, ArchiveMetadata } from "../src/metadata.js";
import { deriveKeys, generateSecret, generateSalt } from "../src/keychain.js";

/**
 * Encrypts arbitrary JSON directly via Web Crypto, bypassing the type-safe
 * encryptMetadata wrapper. Used to test validateMetadata error branches that
 * are unreachable through the normal API.
 */
async function encryptRawJson(
  data: unknown,
  metaKey: CryptoKey,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(META_IV_LENGTH));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, metaKey, encoded);
  return { ciphertext: new Uint8Array(ciphertext), iv };
}

/**
 * Encrypts raw bytes directly via Web Crypto without JSON serialization.
 * Used to produce ciphertext that decrypts to invalid JSON.
 */
async function encryptRawBytes(
  bytes: Uint8Array,
  metaKey: CryptoKey,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(META_IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, metaKey, bytes);
  return { ciphertext: new Uint8Array(ciphertext), iv };
}

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

describe("validateMetadata - invalid shapes (via decryptMetadata)", () => {
  it("should reject null (not an object)", async () => {
    const metaKey = await getMetaKey();
    const enc = await encryptRawJson(null, metaKey);
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "not an object",
    );
  });

  it("should reject a primitive string (not an object)", async () => {
    const metaKey = await getMetaKey();
    const enc = await encryptRawJson("just a string", metaKey);
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "not an object",
    );
  });

  it("should reject single-file metadata with empty name", async () => {
    const metaKey = await getMetaKey();
    const enc = await encryptRawJson(
      { type: "single", name: "", size: 100, mimeType: "text/plain" },
      metaKey,
    );
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "missing or empty file name",
    );
  });

  it("should reject single-file metadata with negative size", async () => {
    const metaKey = await getMetaKey();
    const enc = await encryptRawJson(
      { type: "single", name: "file.txt", size: -1, mimeType: "text/plain" },
      metaKey,
    );
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "invalid file size",
    );
  });

  it("should reject archive metadata where files is not an array", async () => {
    const metaKey = await getMetaKey();
    const enc = await encryptRawJson(
      { type: "archive", files: "not-an-array", totalSize: 0 },
      metaKey,
    );
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "files must be an array",
    );
  });

  it("should reject archive metadata with null file entry", async () => {
    const metaKey = await getMetaKey();
    const enc = await encryptRawJson(
      { type: "archive", files: [null], totalSize: 0 },
      metaKey,
    );
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "file entry must be an object",
    );
  });

  it("should reject archive metadata with file entry having empty name", async () => {
    const metaKey = await getMetaKey();
    const enc = await encryptRawJson(
      { type: "archive", files: [{ name: "", size: 100 }], totalSize: 100 },
      metaKey,
    );
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "file entry missing name",
    );
  });

  it("should reject archive metadata with file entry having negative size", async () => {
    const metaKey = await getMetaKey();
    const enc = await encryptRawJson(
      { type: "archive", files: [{ name: "photo.jpg", size: -1 }], totalSize: 0 },
      metaKey,
    );
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "file entry invalid size",
    );
  });

  it("should reject archive metadata with negative totalSize", async () => {
    const metaKey = await getMetaKey();
    const enc = await encryptRawJson(
      { type: "archive", files: [{ name: "photo.jpg", size: 100 }], totalSize: -1 },
      metaKey,
    );
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "invalid total size",
    );
  });

  it("should reject metadata with unknown type", async () => {
    const metaKey = await getMetaKey();
    const enc = await encryptRawJson({ type: "video", url: "evil.com" }, metaKey);
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "unknown type",
    );
  });

  it("should reject ciphertext that decrypts to invalid JSON", async () => {
    const metaKey = await getMetaKey();
    // Raw bytes that are not valid UTF-8 JSON
    const enc = await encryptRawBytes(new Uint8Array([0xff, 0xfe, 0x00, 0x01]), metaKey);
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "invalid JSON",
    );
  });

  it("should reject single-file metadata with missing mimeType", async () => {
    const metaKey = await getMetaKey();
    const enc = await encryptRawJson(
      { type: "single", name: "file.txt", size: 100 },
      metaKey,
    );
    await expect(decryptMetadata(enc.ciphertext, enc.iv, metaKey)).rejects.toThrow(
      "missing MIME type",
    );
  });
});

describe("validateMetadata - edge cases", () => {
  it("should accept an archive with an empty files array", async () => {
    // An archive with zero entries is technically valid - the validator does not enforce
    // a minimum file count. The application layer is responsible for disallowing empty archives.
    const metaKey = await getMetaKey();
    const metadata: ArchiveMetadata = {
      type: "archive",
      files: [],
      totalSize: 0,
    };
    const encrypted = await encryptMetadata(metadata, metaKey);
    const decrypted = await decryptMetadata(encrypted.ciphertext, encrypted.iv, metaKey);
    expect(decrypted).toEqual(metadata);
    if (decrypted.type === "archive") {
      expect(decrypted.files).toHaveLength(0);
    }
  });
});
