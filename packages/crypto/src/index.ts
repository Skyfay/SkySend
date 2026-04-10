/**
 * @skysend/crypto - Public API
 *
 * End-to-end encryption library for SkySend.
 * Uses only Web Crypto API - works in browsers and Node.js 20+.
 */

// Key generation and derivation
export {
  generateSecret,
  generateSalt,
  deriveKeys,
  computeAuthToken,
  computeOwnerToken,
  SECRET_LENGTH,
  SALT_LENGTH,
} from "./keychain.js";
export type { DerivedKeys } from "./keychain.js";

// Streaming encryption/decryption (ECE)
export {
  createEncryptStream,
  createDecryptStream,
  calculateEncryptedSize,
  calculatePlaintextSize,
  RECORD_SIZE,
  TAG_LENGTH,
  NONCE_LENGTH,
  ENCRYPTED_RECORD_SIZE,
} from "./ece.js";

// Metadata encryption/decryption
export {
  encryptMetadata,
  decryptMetadata,
  META_IV_LENGTH,
} from "./metadata.js";
export type {
  FileMetadata,
  SingleFileMetadata,
  ArchiveMetadata,
  EncryptedMetadata,
} from "./metadata.js";

// Password KDF
export {
  deriveKeyFromPassword,
  deriveKeyFromPasswordPbkdf2,
  deriveKeyFromPasswordArgon2,
  applyPasswordProtection,
  PBKDF2_ITERATIONS,
  DERIVED_KEY_LENGTH,
  PASSWORD_SALT_LENGTH,
  ARGON2_PARAMS,
} from "./password.js";
export type { Argon2idHashFn } from "./password.js";

// Utility helpers
export {
  toBase64url,
  fromBase64url,
  concatBytes,
  encodeUtf8,
  decodeUtf8,
  constantTimeEqual,
  randomBytes,
  nonceXorCounter,
} from "./util.js";
