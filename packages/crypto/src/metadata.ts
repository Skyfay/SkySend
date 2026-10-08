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

/**
 * The block the metadata JSON is padded to with spaces, so the length of the encrypted blob
 * tells little about the names and types of the files in it. JSON allows the trailing spaces,
 * so every reader parses a padded blob like any other, older versions included.
 */
export const METADATA_PAD_BLOCK = 1024;

/**
 * Marks the uploads a sender of a file request sent together, files and a note. 32 hex
 * characters, random per send. Every upload into a request carries one, so the metadata of a
 * note sent alone is as long as the one of a note sent with files.
 */
export interface Submission {
  submission?: string;
}

const SUBMISSION = /^[0-9a-f]{32}$/;

/** The submission of parsed metadata, when it has one of the right form. Anything else is left out. */
function submissionOf(obj: Record<string, unknown>): Submission {
  return typeof obj.submission === "string" && SUBMISSION.test(obj.submission)
    ? { submission: obj.submission }
    : {};
}

/** Metadata for a single-file upload. */
export interface SingleFileMetadata extends Submission {
  type: "single";
  name: string;
  size: number;
  mimeType: string;
}

/** Metadata for a multi-file/folder upload (archived as zip). */
export interface ArchiveMetadata extends Submission {
  type: "archive";
  files: Array<{
    name: string;
    size: number;
  }>;
  /** Sum of the original file sizes, shown to the recipient. */
  totalSize: number;
  /**
   * Byte size of the zip archive, which is the plaintext of the encrypted
   * stream. Missing on archives uploaded by older clients.
   */
  archiveSize?: number;
}

export type FileMetadata = SingleFileMetadata | ArchiveMetadata;

/**
 * Metadata of a note sent into a file request. The stream holds a note document, padded,
 * and `size` is its byte length. Only an inbox reads it: decryptMetadata refuses it, so a
 * crafted normal upload never sends a download page down the path of a note.
 */
export interface NoteUploadMetadata extends Submission {
  type: "note";
  size: number;
}

/** What an upload into a file request carries: a file, an archive, or a note. */
export type RequestUploadMetadata = FileMetadata | NoteUploadMetadata;

/** Result of metadata encryption. */
export interface EncryptedMetadata {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

/**
 * Encrypt file metadata with AES-256-GCM, padded to whole METADATA_PAD_BLOCK blocks.
 *
 * @param metadata - The file metadata to encrypt
 * @param metaKey - The AES-256-GCM key derived for metadata
 * @returns The encrypted ciphertext and the random IV
 */
export async function encryptMetadata(
  metadata: RequestUploadMetadata,
  metaKey: CryptoKey,
): Promise<EncryptedMetadata> {
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const padded = Math.max(1, Math.ceil(json.length / METADATA_PAD_BLOCK)) * METADATA_PAD_BLOCK;
  const plaintext = new Uint8Array(padded).fill(0x20);
  plaintext.set(json);
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
  return validateMetadata(await decryptJson(ciphertext, iv, metaKey));
}

/**
 * Decrypt the metadata of an upload into a file request, which may also be a note. Only the
 * inbox calls this.
 */
export async function decryptRequestMetadata(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  metaKey: CryptoKey,
): Promise<RequestUploadMetadata> {
  const data = await decryptJson(ciphertext, iv, metaKey);
  if (typeof data === "object" && data !== null && (data as { type?: unknown }).type === "note") {
    const { size } = data as { size?: unknown };
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw new Error("Invalid metadata: invalid note size");
    }
    return { type: "note", size, ...submissionOf(data as Record<string, unknown>) };
  }
  return validateMetadata(data);
}

async function decryptJson(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  metaKey: CryptoKey,
): Promise<unknown> {
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

  try {
    return JSON.parse(json);
  } catch {
    throw new Error("Metadata decryption produced invalid JSON");
  }
}

/**
 * The byte size the decrypted file stream must have, to pass to `createDecryptStream`.
 *
 * GCM authenticates each record on its own, so a server can drop whole records from
 * the end of the stream and the rest still decrypts. The metadata is authenticated
 * with the metaKey, so its size is the one the server cannot change. Undefined only
 * for archives uploaded by older clients, which carry no archive size.
 */
export function expectedPlaintextSize(metadata: RequestUploadMetadata): number | undefined {
  return metadata.type === "archive" ? metadata.archiveSize : metadata.size;
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
      ...submissionOf(obj),
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
    if (
      obj.archiveSize !== undefined &&
      (typeof obj.archiveSize !== "number" ||
        !Number.isSafeInteger(obj.archiveSize) ||
        obj.archiveSize < 0)
    ) {
      throw new Error("Invalid metadata: invalid archive size");
    }
    return {
      type: "archive",
      files,
      totalSize: obj.totalSize,
      ...(obj.archiveSize !== undefined ? { archiveSize: obj.archiveSize } : {}),
      ...submissionOf(obj),
    };
  }

  throw new Error("Invalid metadata: unknown type");
}
