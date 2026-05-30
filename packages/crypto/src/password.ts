/**
 * Password-based key derivation for SkySend.
 *
 * When a user sets a password on an upload, the password is used to
 * derive an additional encryption layer. The password never leaves
 * the browser - only a derived key is used.
 *
 * Strategy:
 * Argon2id via WASM (memory-hard, GPU-resistant) is always used for all uploads.
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

import { encodeUtf8 } from "./util.js";

/** Derived key length in bytes. */
export const DERIVED_KEY_LENGTH = 32;

/** Salt length for password KDF. */
export const PASSWORD_SALT_LENGTH = 16;

/** Argon2id parameters (OWASP strong recommendation: 64 MiB, 3 iterations). */
export const ARGON2_PARAMS = {
  memory: 65_536, // 64 MiB (OWASP strong recommendation)
  iterations: 3,
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
  params: { memory: number; iterations: number; parallelism: number } = ARGON2_PARAMS,
): Promise<Uint8Array> {
  if (salt.length !== PASSWORD_SALT_LENGTH) {
    throw new Error(`Password salt must be exactly ${PASSWORD_SALT_LENGTH} bytes`);
  }
  if (password.length === 0) {
    throw new Error("Password must not be empty");
  }

  const passwordBytes = encodeUtf8(password);

  return argon2id(passwordBytes, salt, {
    memory: params.memory,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: DERIVED_KEY_LENGTH,
  });
}

/**
 * Derive a password key using Argon2id.
 *
 * @param password - The user's password
 * @param salt - A unique salt per upload
 * @param argon2id - Argon2id hash function (from WASM)
 * @returns The derived key and algorithm identifier
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  argon2id: Argon2idHashFn,
): Promise<{ key: Uint8Array; algorithm: "argon2id-v2" }> {
  const key = await deriveKeyFromPasswordArgon2(password, salt, argon2id);
  return { key, algorithm: "argon2id-v2" };
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
