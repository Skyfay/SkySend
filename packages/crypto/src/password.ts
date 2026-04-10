/**
 * Password-based key derivation for SkySend.
 *
 * When a user sets a password on an upload, the password is used to
 * derive an additional encryption layer. The password never leaves
 * the browser - only a derived key is used.
 *
 * Strategy:
 * 1. Try Argon2id via WASM (preferred - memory-hard, GPU-resistant)
 * 2. Fall back to PBKDF2-SHA256 with 600,000 iterations (Web Crypto native)
 *
 * The derived key is 32 bytes and used to XOR with the master secret,
 * creating a password-protected secret that requires both the URL
 * fragment and the password to decrypt.
 *
 * Security notes:
 * - Argon2id parameters follow OWASP recommendations
 * - PBKDF2 iteration count follows OWASP 2024 guidance (600,000)
 * - Salt is unique per upload (prevents rainbow tables)
 * - Password is encoded as UTF-8 before hashing
 */

import { encodeUtf8, asBytes } from "./util.js";

/** PBKDF2 iteration count (OWASP 2024 recommendation for SHA-256). */
export const PBKDF2_ITERATIONS = 600_000;

/** Derived key length in bytes. */
export const DERIVED_KEY_LENGTH = 32;

/** Salt length for password KDF. */
export const PASSWORD_SALT_LENGTH = 16;

/** Argon2id parameters (OWASP recommendations). */
export const ARGON2_PARAMS = {
  memory: 19_456, // 19 MiB (OWASP minimum for Argon2id)
  iterations: 2,
  parallelism: 1,
} as const;

/** Argon2id hash function type - to be provided by the consumer. */
export type Argon2idHashFn = (
  password: Uint8Array,
  salt: Uint8Array,
  params: {
    memory: number;
    iterations: number;
    parallelism: number;
    hashLength: number;
  },
) => Promise<Uint8Array>;

/**
 * Derive a 32-byte key from a password using PBKDF2-SHA256.
 *
 * This is the built-in fallback that uses only the Web Crypto API.
 * Used when Argon2id WASM is not available (e.g., older browsers).
 */
export async function deriveKeyFromPasswordPbkdf2(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  if (salt.length !== PASSWORD_SALT_LENGTH) {
    throw new Error(`Password salt must be exactly ${PASSWORD_SALT_LENGTH} bytes`);
  }
  if (password.length === 0) {
    throw new Error("Password must not be empty");
  }

  const passwordBytes = encodeUtf8(password);

  const baseKey = await crypto.subtle.importKey("raw", asBytes(passwordBytes), "PBKDF2", false, [
    "deriveBits",
  ]);

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: asBytes(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    baseKey,
    DERIVED_KEY_LENGTH * 8,
  );

  return new Uint8Array(bits);
}

/**
 * Derive a 32-byte key from a password using Argon2id.
 *
 * The Argon2id hash function must be provided by the caller
 * (typically loaded from a WASM module). This keeps the crypto
 * package free of WASM dependencies.
 *
 * @param password - The user's password
 * @param salt - A unique salt per upload
 * @param argon2id - The Argon2id hash function (from WASM)
 */
export async function deriveKeyFromPasswordArgon2(
  password: string,
  salt: Uint8Array,
  argon2id: Argon2idHashFn,
): Promise<Uint8Array> {
  if (salt.length !== PASSWORD_SALT_LENGTH) {
    throw new Error(`Password salt must be exactly ${PASSWORD_SALT_LENGTH} bytes`);
  }
  if (password.length === 0) {
    throw new Error("Password must not be empty");
  }

  const passwordBytes = encodeUtf8(password);

  return argon2id(passwordBytes, salt, {
    memory: ARGON2_PARAMS.memory,
    iterations: ARGON2_PARAMS.iterations,
    parallelism: ARGON2_PARAMS.parallelism,
    hashLength: DERIVED_KEY_LENGTH,
  });
}

/**
 * Derive a password key with automatic algorithm selection.
 *
 * Tries Argon2id first (if provided), then falls back to PBKDF2.
 *
 * @param password - The user's password
 * @param salt - A unique salt per upload
 * @param argon2id - Optional Argon2id hash function (from WASM)
 * @returns The derived key and which algorithm was used
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  argon2id?: Argon2idHashFn,
): Promise<{ key: Uint8Array; algorithm: "argon2id" | "pbkdf2" }> {
  if (argon2id) {
    try {
      const key = await deriveKeyFromPasswordArgon2(password, salt, argon2id);
      return { key, algorithm: "argon2id" };
    } catch {
      // Argon2id failed (e.g., WASM not supported), fall through to PBKDF2
    }
  }

  const key = await deriveKeyFromPasswordPbkdf2(password, salt);
  return { key, algorithm: "pbkdf2" };
}

/**
 * Apply password protection to a secret by XORing with the password-derived key.
 *
 * protectedSecret = secret XOR passwordKey
 *
 * To recover the original secret, XOR again with the same passwordKey.
 * This is reversible: secret = protectedSecret XOR passwordKey
 */
export function applyPasswordProtection(secret: Uint8Array, passwordKey: Uint8Array): Uint8Array {
  if (secret.length !== DERIVED_KEY_LENGTH) {
    throw new Error(`Secret must be exactly ${DERIVED_KEY_LENGTH} bytes`);
  }
  if (passwordKey.length !== DERIVED_KEY_LENGTH) {
    throw new Error(`Password key must be exactly ${DERIVED_KEY_LENGTH} bytes`);
  }

  const result = new Uint8Array(DERIVED_KEY_LENGTH);
  for (let i = 0; i < DERIVED_KEY_LENGTH; i++) {
    result[i] = secret[i]! ^ passwordKey[i]!;
  }
  return result;
}
