import { describe, expect, it } from "vitest";
import {
  encryptMetadata,
  decryptMetadata,
  decryptRequestMetadata,
  expectedPlaintextSize,
  META_IV_LENGTH,
} from "../src/metadata.js";
import type { FileMetadata, SingleFileMetadata, ArchiveMetadata } from "../src/metadata.js";
import { deriveKeys, generateSecret, generateSalt } from "../src/keychain.js";
import { asBytes } from "../src/util.js";
import { flipped } from "./helpers.js";

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
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, metaKey, asBytes(bytes));
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
    const tampered = flipped(encrypted.ciphertext);
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

describe("archive size", () => {
  it("should round-trip the archive size", async () => {
    const metaKey = await getMetaKey();
    const metadata: ArchiveMetadata = {
      type: "archive",
      files: [{ name: "a.txt", size: 10 }],
      totalSize: 10,
      archiveSize: 132,
    };
    const encrypted = await encryptMetadata(metadata, metaKey);
    const decrypted = await decryptMetadata(encrypted.ciphertext, encrypted.iv, metaKey);
    expect(decrypted).toEqual(metadata);
  });

  it("should accept an archive from an older client without an archive size", async () => {
    const metaKey = await getMetaKey();
    const { ciphertext, iv } = await encryptRawJson(
      { type: "archive", files: [{ name: "a.txt", size: 10 }], totalSize: 10 },
      metaKey,
    );
    const decrypted = await decryptMetadata(ciphertext, iv, metaKey);
    expect(decrypted).toEqual({
      type: "archive",
      files: [{ name: "a.txt", size: 10 }],
      totalSize: 10,
    });
    expect("archiveSize" in decrypted).toBe(false);
  });

  it.each([-1, 1.5, "132", null])(
    "should reject an archive size of %s",
    async (archiveSize) => {
      const metaKey = await getMetaKey();
      const { ciphertext, iv } = await encryptRawJson(
        { type: "archive", files: [], totalSize: 0, archiveSize },
        metaKey,
      );
      await expect(decryptMetadata(ciphertext, iv, metaKey)).rejects.toThrow(
        "invalid archive size",
      );
    },
  );
});

describe("expectedPlaintextSize", () => {
  it("should be the file size of a single file", () => {
    expect(
      expectedPlaintextSize({ type: "single", name: "a.txt", size: 42, mimeType: "text/plain" }),
    ).toBe(42);
  });

  it("should be the archive size of an archive, not the sum of its files", () => {
    expect(
      expectedPlaintextSize({
        type: "archive",
        files: [{ name: "a.txt", size: 10 }],
        totalSize: 10,
        archiveSize: 132,
      }),
    ).toBe(132);
  });

  it("should be undefined for an archive from an older client", () => {
    expect(
      expectedPlaintextSize({ type: "archive", files: [{ name: "a.txt", size: 10 }], totalSize: 10 }),
    ).toBeUndefined();
  });

  it("should be the padded size of a note", () => {
    expect(expectedPlaintextSize({ type: "note", size: 2048 })).toBe(2048);
  });
});

describe("metadata of uploads into a file request", () => {
  it("should round-trip the metadata of a note, and of a file as before", async () => {
    const metaKey = await getMetaKey();
    const note = await encryptMetadata({ type: "note", size: 1024 }, metaKey);
    expect(await decryptRequestMetadata(note.ciphertext, note.iv, metaKey)).toEqual({
      type: "note",
      size: 1024,
    });
    const file = { type: "single", name: "a.pdf", size: 3, mimeType: "application/pdf" } as const;
    const encrypted = await encryptMetadata(file, metaKey);
    expect(await decryptRequestMetadata(encrypted.ciphertext, encrypted.iv, metaKey)).toEqual(file);
  });

  it("should keep a note away from the reader of normal uploads", async () => {
    const metaKey = await getMetaKey();
    const note = await encryptMetadata({ type: "note", size: 1024 }, metaKey);
    await expect(decryptMetadata(note.ciphertext, note.iv, metaKey)).rejects.toThrow(
      "unknown type",
    );
  });

  it("should reject a note without a sound size, and keep extra fields out", async () => {
    const metaKey = await getMetaKey();
    for (const size of [undefined, -1, 1.5, "1024", Number.MAX_SAFE_INTEGER + 1]) {
      const raw = await encryptRawJson({ type: "note", size }, metaKey);
      await expect(decryptRequestMetadata(raw.ciphertext, raw.iv, metaKey)).rejects.toThrow(
        "invalid note size",
      );
    }
    const extra = await encryptRawJson({ type: "note", size: 1, name: "<b>" }, metaKey);
    expect(await decryptRequestMetadata(extra.ciphertext, extra.iv, metaKey)).toEqual({
      type: "note",
      size: 1,
    });
  });

  it("should fail like decryptMetadata on a wrong key or broken JSON", async () => {
    const metaKey = await getMetaKey();
    const raw = await encryptRawBytes(new TextEncoder().encode("{"), metaKey);
    await expect(decryptRequestMetadata(raw.ciphertext, raw.iv, metaKey)).rejects.toThrow(
      "invalid JSON",
    );
    const nul = await encryptRawJson(null, metaKey);
    await expect(decryptRequestMetadata(nul.ciphertext, nul.iv, metaKey)).rejects.toThrow(
      "not an object",
    );
    const note = await encryptMetadata({ type: "note", size: 1 }, metaKey);
    await expect(
      decryptRequestMetadata(note.ciphertext, note.iv, await getMetaKey()),
    ).rejects.toThrow("decryption failed");
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
