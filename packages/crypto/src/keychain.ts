/**
 * Key generation and derivation for SkySend.
 *
 * Secret (32 bytes) -> HKDF-SHA256 -> fileKey, metaKey, authKey
 *
 * Security notes:
 * - The 32-byte secret is generated via crypto.getRandomValues (CSPRNG)
 * - HKDF uses distinct info strings per derived key to ensure domain separation
 * - The salt is bound to each upload and stored alongside the ciphertext
 * - fileKey and metaKey are AES-256-GCM keys
 * - authKey is used with HMAC-SHA256 to produce an auth token
 */

import { asBytes, randomBytes } from "./util.js";

/** Length of the master secret in bytes (256 bits). */
export const SECRET_LENGTH = 32;

/** Length of the salt used in HKDF derivation (16 bytes). */
export const SALT_LENGTH = 16;

/** HKDF info strings for domain separation. */
const HKDF_INFO_FILE = "skysend-file-encryption";
const HKDF_INFO_META = "skysend-metadata";
const HKDF_INFO_AUTH = "skysend-authentication";

/** Result of key derivation - all keys needed for an upload. */
export interface DerivedKeys {
  fileKey: CryptoKey;
  metaKey: CryptoKey;
  authKey: CryptoKey;
}

/** Generate a new 256-bit cryptographic secret. */
export function generateSecret(): Uint8Array {
  return randomBytes(SECRET_LENGTH);
}

/** Generate a new random salt for key derivation. */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_LENGTH);
}

/**
 * Import the raw secret as an HKDF base key.
 *
 * The secret is imported as non-extractable to prevent
 * accidental exposure via `exportKey()`.
 */
async function importHkdfKey(secret: Uint8Array): Promise<CryptoKey> {
  if (secret.length !== SECRET_LENGTH) {
    throw new Error(`Secret must be exactly ${SECRET_LENGTH} bytes`);
  }
  return crypto.subtle.importKey("raw", asBytes(secret), "HKDF", false, ["deriveKey", "deriveBits"]);
}

/**
 * Derive an AES-256-GCM key from the HKDF base key.
 */
async function deriveAesGcmKey(
  baseKey: CryptoKey,
  salt: Uint8Array,
  info: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: asBytes(salt),
      info: asBytes(encoder.encode(info)),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

/**
 * Derive an HMAC-SHA256 key from the HKDF base key.
 */
async function deriveHmacKey(
  baseKey: CryptoKey,
  salt: Uint8Array,
  info: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: asBytes(salt),
      info: asBytes(encoder.encode(info)),
    },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false, // non-extractable
    ["sign", "verify"],
  );
}

/**
 * Derive all three keys (fileKey, metaKey, authKey) from a secret and salt.
 *
 * Each key uses a distinct HKDF info string for cryptographic domain separation.
 * All derived keys are non-extractable - they can only be used for their
 * intended operations (encrypt/decrypt or sign/verify).
 */
export async function deriveKeys(secret: Uint8Array, salt: Uint8Array): Promise<DerivedKeys> {
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`Salt must be exactly ${SALT_LENGTH} bytes`);
  }

  const baseKey = await importHkdfKey(secret);

  const [fileKey, metaKey, authKey] = await Promise.all([
    deriveAesGcmKey(baseKey, salt, HKDF_INFO_FILE),
    deriveAesGcmKey(baseKey, salt, HKDF_INFO_META),
    deriveHmacKey(baseKey, salt, HKDF_INFO_AUTH),
  ]);

  return { fileKey, metaKey, authKey };
}

/**
 * Compute an auth token from the authKey.
 *
 * The auth token is HMAC-SHA256(authKey, "skysend-auth-token").
 * This produces a deterministic 32-byte token that the server can
 * verify without knowing the secret.
 */
export async function computeAuthToken(authKey: CryptoKey): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode("skysend-auth-token");
  const signature = await crypto.subtle.sign("HMAC", authKey, data);
  return new Uint8Array(signature);
}

/**
 * Compute an owner token from the secret.
 *
 * The owner token is derived independently using HKDF with a distinct info string.
 * This allows the uploader to prove ownership without exposing the secret.
 * The server stores this token to authorize deletion requests.
 */
export async function computeOwnerToken(secret: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  if (secret.length !== SECRET_LENGTH) {
    throw new Error(`Secret must be exactly ${SECRET_LENGTH} bytes`);
  }
  const baseKey = await importHkdfKey(secret);
  const encoder = new TextEncoder();
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: asBytes(salt),
      info: asBytes(encoder.encode("skysend-owner-token")),
    },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}
