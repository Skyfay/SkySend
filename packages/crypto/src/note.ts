/**
 * Note encryption/decryption for SkySend.
 *
 * Note content (text, passwords, code snippets) is encrypted client-side
 * with AES-256-GCM using the metaKey derived from HKDF and a random 12-byte nonce.
 *
 * The encrypted content and nonce are stored in the database.
 * Unlike file uploads, notes do not use streaming encryption (ECE) since
 * they are small enough to encrypt in a single operation.
 *
 * Security notes:
 * - A fresh random nonce is generated for each note encryption
 * - GCM provides both confidentiality and authenticity
 * - The nonce does not need to be secret, only unique per encryption
 */

import { randomBytes, asBytes, encodeUtf8, decodeUtf8 } from "./util.js";

/** Nonce length for note encryption (12 bytes for AES-GCM). */
export const NOTE_NONCE_LENGTH = 12;

/** Supported note content types. */
export type NoteContentType = "text" | "password" | "code";

/** Metadata describing a note (not the encrypted content itself). */
export interface NoteMetadata {
  type: "note";
  contentType: NoteContentType;
  /** Optional language hint for code notes (e.g. "javascript", "python"). */
  language?: string;
}

/** Result of note content encryption. */
export interface EncryptedNoteContent {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/**
 * Encrypt note content with AES-256-GCM.
 *
 * @param content - The plaintext note content (UTF-8 string)
 * @param metaKey - The AES-256-GCM key derived for metadata/notes
 * @returns The encrypted ciphertext and the random nonce
 */
export async function encryptNoteContent(
  content: string,
  metaKey: CryptoKey,
): Promise<EncryptedNoteContent> {
  const plaintext = encodeUtf8(content);
  const nonce = randomBytes(NOTE_NONCE_LENGTH);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBytes(nonce), tagLength: 128 },
    metaKey,
    asBytes(plaintext),
  );

  return {
    ciphertext: new Uint8Array(ciphertext),
    nonce,
  };
}

/**
 * Decrypt note content from AES-256-GCM ciphertext.
 *
 * @param ciphertext - The encrypted note content
 * @param nonce - The nonce used during encryption
 * @param metaKey - The AES-256-GCM key derived for metadata/notes
 * @returns The decrypted plaintext content as a UTF-8 string
 * @throws If decryption fails (wrong key, tampered data)
 */
export async function decryptNoteContent(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  metaKey: CryptoKey,
): Promise<string> {
  if (nonce.length !== NOTE_NONCE_LENGTH) {
    throw new Error(`Note nonce must be exactly ${NOTE_NONCE_LENGTH} bytes`);
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBytes(nonce), tagLength: 128 },
      metaKey,
      asBytes(ciphertext),
    );
  } catch {
    throw new Error("Note decryption failed - data may be corrupted or tampered with");
  }

  return decodeUtf8(new Uint8Array(plaintext));
}
