/**
 * Bytes sealed with a password, for what leaves the browser as a file or a link, like the
 * note templates a requester exports.
 *
 * Argon2id turns the password and a random salt into an AES-256-GCM key, with parameters of its
 * own that match a password on an upload, and the key encrypts under a random nonce. The
 * purpose string is the AAD, so a box made for one thing does not open as another.
 */

import {
  deriveKeyFromPasswordArgon2,
  PASSWORD_SALT_LENGTH,
  type Argon2idHashFn,
} from "./password.js";
import { asBytes, encodeUtf8, randomBytes } from "./util.js";

/** Nonce length of a password box (12 bytes for AES-GCM). */
export const PASSWORD_BOX_NONCE_LENGTH = 12;

/**
 * The Argon2id parameters of every password box, the ones of an upload password today. A box
 * stores none of them, so they are frozen here: changing them would leave every sealed export
 * unopenable.
 */
export const PASSWORD_BOX_ARGON2 = { memory: 65_536, iterations: 3, parallelism: 1 } as const;
/** The shortest ciphertext of a password box: the GCM tag of an empty plaintext. */
const MIN_CIPHERTEXT_LENGTH = 16;

export interface PasswordBox {
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/** The AES-GCM key behind a password, usable for one direction only and never extractable. */
async function boxKey(
  password: string,
  salt: Uint8Array,
  argon2id: Argon2idHashFn,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const raw = await deriveKeyFromPasswordArgon2(password, salt, argon2id, PASSWORD_BOX_ARGON2);
  try {
    return await crypto.subtle.importKey("raw", asBytes(raw), "AES-GCM", false, [usage]);
  } finally {
    raw.fill(0);
  }
}

/** Seals the bytes with a password, for the given purpose. */
export async function sealWithPassword(
  plaintext: Uint8Array,
  password: string,
  purpose: string,
  argon2id: Argon2idHashFn,
): Promise<PasswordBox> {
  const salt = randomBytes(PASSWORD_SALT_LENGTH);
  const nonce = randomBytes(PASSWORD_BOX_NONCE_LENGTH);
  const key = await boxKey(password, salt, argon2id, "encrypt");
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBytes(nonce), additionalData: asBytes(encodeUtf8(purpose)) },
    key,
    asBytes(plaintext),
  );
  return { salt, nonce, ciphertext: new Uint8Array(ciphertext) };
}

/**
 * Opens a box sealed for the given purpose. Throws for a wrong password, another purpose, or
 * a box that was changed.
 */
export async function openWithPassword(
  box: PasswordBox,
  password: string,
  purpose: string,
  argon2id: Argon2idHashFn,
): Promise<Uint8Array> {
  if (box.nonce.length !== PASSWORD_BOX_NONCE_LENGTH) {
    throw new Error(`Password box nonce must be exactly ${PASSWORD_BOX_NONCE_LENGTH} bytes`);
  }
  if (box.ciphertext.length < MIN_CIPHERTEXT_LENGTH) {
    throw new Error("Password box ciphertext is too short");
  }
  const key = await boxKey(password, box.salt, argon2id, "decrypt");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBytes(box.nonce), additionalData: asBytes(encodeUtf8(purpose)) },
    key,
    asBytes(box.ciphertext),
  );
  return new Uint8Array(plaintext);
}
