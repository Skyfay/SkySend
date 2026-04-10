/**
 * Metadata encryption/decryption for SkySend.
 *
 * Metadata (file names, sizes, MIME types) is encrypted with AES-256-GCM
 * using the metaKey derived from HKDF and a random 12-byte IV.
 *
 * The metadata is serialized as JSON, encoded to UTF-8, then encrypted.
 * The IV is stored separately (in the database) alongside the ciphertext.
 *
 * Security notes:
 * - A fresh random IV is generated for each metadata encryption
 * - The IV does not need to be secret, only unique per encryption
 * - GCM provides both confidentiality and authenticity
 */

import { randomBytes, asBytes } from "./util.js";

/** IV length for metadata encryption (12 bytes for AES-GCM). */
export const META_IV_LENGTH = 12;

/** Metadata for a single-file upload. */
export interface SingleFileMetadata {
  type: "single";
  name: string;
  size: number;
  mimeType: string;
}

/** Metadata for a multi-file/folder upload (archived as zip). */
export interface ArchiveMetadata {
  type: "archive";
  files: Array<{
    name: string;
    size: number;
  }>;
  totalSize: number;
}

export type FileMetadata = SingleFileMetadata | ArchiveMetadata;

/** Result of metadata encryption. */
export interface EncryptedMetadata {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

/**
 * Encrypt file metadata with AES-256-GCM.
 *
 * @param metadata - The file metadata to encrypt
 * @param metaKey - The AES-256-GCM key derived for metadata
 * @returns The encrypted ciphertext and the random IV
 */
export async function encryptMetadata(
  metadata: FileMetadata,
  metaKey: CryptoKey,
): Promise<EncryptedMetadata> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(metadata));
  const iv = randomBytes(META_IV_LENGTH);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBytes(iv), tagLength: 128 },
    metaKey,
    asBytes(plaintext),
  );

  return {
    ciphertext: new Uint8Array(ciphertext),
    iv,
  };
}

/**
 * Decrypt file metadata from AES-256-GCM ciphertext.
 *
 * @param ciphertext - The encrypted metadata
 * @param iv - The IV used during encryption
 * @param metaKey - The AES-256-GCM key derived for metadata
 * @returns The decrypted and parsed file metadata
 * @throws If decryption fails (wrong key, tampered data) or JSON is invalid
 */
export async function decryptMetadata(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  metaKey: CryptoKey,
): Promise<FileMetadata> {
  if (iv.length !== META_IV_LENGTH) {
    throw new Error(`Metadata IV must be exactly ${META_IV_LENGTH} bytes`);
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBytes(iv), tagLength: 128 },
      metaKey,
      asBytes(ciphertext),
    );
  } catch {
    throw new Error("Metadata decryption failed - data may be corrupted or tampered with");
  }

  const decoder = new TextDecoder();
  const json = decoder.decode(plaintext);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Metadata decryption produced invalid JSON");
  }

  return validateMetadata(parsed);
}

/** Validate that parsed JSON conforms to the FileMetadata shape. */
function validateMetadata(data: unknown): FileMetadata {
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid metadata: not an object");
  }

  const obj = data as Record<string, unknown>;

  if (obj.type === "single") {
    if (typeof obj.name !== "string" || obj.name.length === 0) {
      throw new Error("Invalid metadata: missing or empty file name");
    }
    if (typeof obj.size !== "number" || obj.size < 0) {
      throw new Error("Invalid metadata: invalid file size");
    }
    if (typeof obj.mimeType !== "string") {
      throw new Error("Invalid metadata: missing MIME type");
    }
    return {
      type: "single",
      name: obj.name,
      size: obj.size,
      mimeType: obj.mimeType,
    };
  }

  if (obj.type === "archive") {
    if (!Array.isArray(obj.files)) {
      throw new Error("Invalid metadata: files must be an array");
    }
    const files: Array<{ name: string; size: number }> = [];
    for (const file of obj.files) {
      if (typeof file !== "object" || file === null) {
        throw new Error("Invalid metadata: file entry must be an object");
      }
      const f = file as Record<string, unknown>;
      if (typeof f.name !== "string" || f.name.length === 0) {
        throw new Error("Invalid metadata: file entry missing name");
      }
      if (typeof f.size !== "number" || f.size < 0) {
        throw new Error("Invalid metadata: file entry invalid size");
      }
      files.push({ name: f.name, size: f.size });
    }
    if (typeof obj.totalSize !== "number" || obj.totalSize < 0) {
      throw new Error("Invalid metadata: invalid total size");
    }
    return {
      type: "archive",
      files,
      totalSize: obj.totalSize,
    };
  }

  throw new Error("Invalid metadata: unknown type");
}
