/**
 * What a recipient needs before the ciphertext arrives: the keys from the link and the password,
 * and the metadata. And the decryption of the download itself, which checks the stream against
 * the authenticated metadata.
 */
import {
  applyPasswordProtection,
  computeAuthToken,
  createDecryptStream,
  decryptMetadata,
  deriveKeyFromPassword,
  deriveKeys,
  expectedBaseNonce,
  expectedPlaintextSize,
  fromBase64url,
  toBase64url,
  type Argon2idHashFn,
  type DerivedKeys,
  type FileMetadata,
} from "@skysend/crypto";
import type { UploadInfo } from "./api.js";

/** The keys of a share and the token that proves the link to the server. */
export interface LinkKeys {
  /** The real secret, after the password protection came off. */
  secret: Uint8Array;
  salt: Uint8Array;
  keys: DerivedKeys;
  /** base64url, sent as X-Auth-Token. */
  authToken: string;
}

/** The password of a protected share, with what it takes to turn it into a key. */
export interface LinkPassword {
  password: string;
  /** base64url, from the info of the share. */
  saltB64: string;
  argon2id: Argon2idHashFn;
}

/** Derives the file, metadata and auth keys from an already recovered secret. */
export async function keysFromSecret(secret: Uint8Array, saltB64: string): Promise<LinkKeys> {
  const salt = fromBase64url(saltB64);
  const keys = await deriveKeys(secret, salt);
  const authToken = toBase64url(await computeAuthToken(keys.authKey));
  return { secret, salt, keys, authToken };
}

/**
 * Recovers the secret from the link fragment, taking the password protection off when the
 * share has one, and derives the keys from it.
 */
export async function keysFromLink(
  secretB64: string,
  saltB64: string,
  password?: LinkPassword,
): Promise<LinkKeys> {
  let secret = fromBase64url(secretB64);
  if (password?.password) {
    if (!password.saltB64) throw new Error("Missing password salt");
    const { key } = await deriveKeyFromPassword(
      password.password,
      fromBase64url(password.saltB64),
      password.argon2id,
    );
    secret = applyPasswordProtection(secret, key);
  }
  return keysFromSecret(secret, saltB64);
}

/** Bytes of standard base64, the way the server keeps the metadata of an upload. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decrypts the metadata of an upload. Null for an upload that carries none. */
export async function decryptUploadMetadata(
  info: Pick<UploadInfo, "encryptedMeta" | "nonce">,
  metaKey: CryptoKey,
): Promise<FileMetadata | null> {
  if (!info.encryptedMeta || !info.nonce) return null;
  return decryptMetadata(fromBase64(info.encryptedMeta), fromBase64(info.nonce), metaKey);
}

/**
 * The plaintext of a download. It fails on a stream the server cut short, by the size in the
 * metadata, and on records the server reordered, by the base nonce the metadata names. An upload
 * of an older client without a base nonce decrypts without that check.
 */
export function decryptedStream(
  ciphertext: ReadableStream<Uint8Array>,
  metadata: FileMetadata,
  fileKey: CryptoKey,
): ReadableStream<Uint8Array> {
  return ciphertext.pipeThrough(
    createDecryptStream(fileKey, expectedPlaintextSize(metadata), expectedBaseNonce(metadata)),
  );
}
