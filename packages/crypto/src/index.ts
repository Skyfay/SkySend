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
  TOKEN_LENGTH,
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
  decryptRequestMetadata,
  expectedPlaintextSize,
  META_IV_LENGTH,
} from "./metadata.js";
export type {
  FileMetadata,
  SingleFileMetadata,
  ArchiveMetadata,
  NoteUploadMetadata,
  RequestUploadMetadata,
  Submission,
  EncryptedMetadata,
} from "./metadata.js";

// Password KDF
export {
  deriveKeyFromPassword,
  deriveKeyFromPasswordArgon2,
  applyPasswordProtection,
  meetsPasswordMinimum,
  DERIVED_KEY_LENGTH,
  PASSWORD_SALT_LENGTH,
  MIN_PASSWORD_LENGTH,
  ARGON2_PARAMS,
} from "./password.js";
export type { Argon2idHashFn } from "./password.js";

// Bytes sealed with a password, for exports that leave the browser
export {
  sealWithPassword,
  openWithPassword,
  PASSWORD_BOX_ARGON2,
  PASSWORD_BOX_NONCE_LENGTH,
} from "./password-box.js";
export type { PasswordBox } from "./password-box.js";

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

// File requests: HPKE wrap of file secrets to a requester's public key
export {
  createFileRequest,
  deriveInboxKeys,
  deriveLinkKeys,
  openRequestKey,
  wrapFileSecret,
  unwrapFileSecret,
  encryptRequestBrief,
  decryptRequestBrief,
  encodeUploadFragment,
  decodeUploadFragment,
  encodeInboxFragment,
  decodeInboxFragment,
  applyInboxPassword,
  INBOX_PASSWORD_ARGON2,
  REQUEST_SUITE,
  REQUEST_SECRET_LENGTH,
  REQUEST_NONCE_LENGTH,
  REQUEST_TOKEN_LENGTH,
  REQUEST_VAULT_LENGTH,
  REQUEST_TITLE_MAX_BYTES,
  REQUEST_BRIEF_BLOCK,
  REQUEST_BRIEF_MAX_BYTES,
  REQUEST_BRIEF_MAX_CIPHERTEXT_LENGTH,
  REQUEST_BRIEF_MIN_CIPHERTEXT_LENGTH,
  WRAP_ENC_LENGTH,
  WRAP_CIPHERTEXT_LENGTH,
} from "./request.js";
export type {
  InboxKeys,
  LinkKeys,
  EncryptedRequestBrief,
  RequestAsk,
  RequestBrief,
  FileRequestSecrets,
  FileRequestPayload,
  NewFileRequest,
  RequestKey,
  WrappedFileSecret,
} from "./request.js";

// Note encryption/decryption
export {
  encryptNoteContent,
  decryptNoteContent,
  NOTE_NONCE_LENGTH,
} from "./note.js";
export type {
  NoteContentType,
  NoteMetadata,
  EncryptedNoteContent,
} from "./note.js";
