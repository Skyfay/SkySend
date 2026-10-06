/**
 * File requests: a requester asks for files, senders drop them in, only the requester reads them.
 *
 * The requester's browser makes a P-256 key pair and two secrets:
 *
 *   inboxSecret -> HKDF -> inboxKey (seals the private key), inboxAuthToken, inboxOwnerToken
 *   linkSecret  -> HKDF -> uploadToken (lets a sender upload), titleKey (the request's title)
 *
 * The private key is sealed with inboxKey and stored on the server, the "vault". The public
 * key and linkSecret travel only in the fragment of the upload link, inboxSecret only in the
 * fragment of the inbox link. The server never holds a key that opens anything, and it never
 * learns the public key: base-mode HPKE does not authenticate senders, so whoever knows the
 * public key can put an upload into the inbox.
 *
 * Both secrets are 32 uniform bytes, so the derivation needs no salt. That keeps every link
 * self-contained: a sender and the requester derive their token from the fragment alone, and
 * no endpoint has to hand out a salt before the token is checked. The upload token and the
 * title key also take the public key, so a link rewritten with another key is rejected.
 *
 * A sender uploads a file the usual way, with a fresh file secret, and wraps that secret to
 * the public key with HPKE (hpke.ts). The wrap is bound to the request and the upload, so the
 * server cannot move it to another one. Only the requester's private key unwraps it.
 *
 * Wire formats:
 *
 *   upload fragment  base64url(suite 1 B || publicKey 65 B || linkSecret 32 B)
 *   inbox fragment   base64url(version 1 B || secret 32 B || passwordSalt 16 B, if protected)
 *   vault plaintext  suite 1 B || publicKey 65 B || linkSecret 32 B || private scalar d 32 B
 *   vault            AES-256-GCM(inboxKey, nonce 12 B, aad "skysend-inbox-privkey-v1"), 146 B
 *   wrap             HPKE base, info "skysend-request-v1" || requestId 16 B, aad uploadId 16 B,
 *                    plaintext the 32-byte file secret, stored as enc 65 B and ciphertext 48 B
 *   title            AES-256-GCM(titleKey, nonce 12 B, aad "skysend-request-title-v1")
 */

import { importHkdfKey, SECRET_LENGTH } from "./keychain.js";
import { PASSWORD_SALT_LENGTH } from "./password.js";
import {
  assertUncompressedPoint,
  HPKE_PUBLIC_KEY_LENGTH,
  importPublicKey,
  openBase,
  P256,
  sealBase,
} from "./hpke.js";
import {
  asBytes,
  concatBytes,
  decodeUtf8,
  encodeUtf8,
  fromBase64url,
  randomBytes,
  toBase64url,
} from "./util.js";

/** The suite byte: HPKE DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM. */
export const REQUEST_SUITE = 0x01;

/** Length of inboxSecret and linkSecret. */
export const REQUEST_SECRET_LENGTH = 32;

/** Length of the vault nonce and the title nonce. */
export const REQUEST_NONCE_LENGTH = 12;

/** Length of inboxAuthToken, inboxOwnerToken and uploadToken. */
export const REQUEST_TOKEN_LENGTH = 32;

/** Length of the sealed vault. */
export const REQUEST_VAULT_LENGTH = 1 + HPKE_PUBLIC_KEY_LENGTH + REQUEST_SECRET_LENGTH + 32 + 16;

/** The longest title in UTF-8 bytes, and the longest title ciphertext. */
export const REQUEST_TITLE_MAX_BYTES = 256;
export const REQUEST_TITLE_MAX_CIPHERTEXT_LENGTH = REQUEST_TITLE_MAX_BYTES + 16;

/** Length of the enc and the ciphertext of a wrapped file secret. */
export const WRAP_ENC_LENGTH = HPKE_PUBLIC_KEY_LENGTH;
export const WRAP_CIPHERTEXT_LENGTH = SECRET_LENGTH + 16;

const SCALAR_LENGTH = 32;
const VAULT_PLAINTEXT_LENGTH = REQUEST_VAULT_LENGTH - 16;
const UPLOAD_FRAGMENT_LENGTH = 1 + HPKE_PUBLIC_KEY_LENGTH + REQUEST_SECRET_LENGTH;
const INBOX_FRAGMENT_VERSION = 0x01;
const NO_SALT = new Uint8Array(0);

// HKDF info strings and AAD labels. Part of the wire format, distinct from keychain.ts.
const INFO_INBOX_KEY = "skysend-inbox-key";
const INFO_INBOX_AUTH = "skysend-inbox-auth";
const INFO_INBOX_OWNER = "skysend-inbox-owner-token";
const INFO_UPLOAD_TOKEN = "skysend-request-upload-token";
const INFO_TITLE_KEY = "skysend-request-title";
const HPKE_INFO = "skysend-request-v1";
const VAULT_AAD = "skysend-inbox-privkey-v1";
const TITLE_AAD = "skysend-request-title-v1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keys derived from inboxSecret. inboxKey cannot be exported. Both tokens come from the same
 * secret, so the inbox link can read and delete. Two tokens keep the two apart on the server.
 */
export interface InboxKeys {
  inboxKey: CryptoKey;
  inboxAuthToken: Uint8Array;
  inboxOwnerToken: Uint8Array;
}

/** Keys derived from linkSecret and the public key. titleKey cannot be exported. */
export interface LinkKeys {
  uploadToken: Uint8Array;
  titleKey: CryptoKey;
}

/** An encrypted title. */
export interface EncryptedRequestTitle {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/** What only the requester's browser holds. Never send any of it to the server. */
export interface FileRequestSecrets {
  inboxSecret: Uint8Array;
  linkSecret: Uint8Array;
  publicKey: Uint8Array;
}

/** What the server stores for a request. */
export interface FileRequestPayload {
  vault: Uint8Array;
  vaultNonce: Uint8Array;
  inboxAuthToken: Uint8Array;
  inboxOwnerToken: Uint8Array;
  uploadToken: Uint8Array;
  title: EncryptedRequestTitle | null;
}

/** A new request: the secrets for the links, kept apart from what goes to the server. */
export interface NewFileRequest {
  local: FileRequestSecrets;
  server: FileRequestPayload;
}

/** The opened vault. The private key can only derive bits. */
export interface RequestKey {
  publicKey: Uint8Array;
  linkSecret: Uint8Array;
  privateKey: CryptoKey;
}

/** A file secret wrapped to the request's public key. */
export interface WrappedFileSecret {
  enc: Uint8Array;
  ciphertext: Uint8Array;
}

/** The 16 bytes of a UUID, which the wrap binds as request and upload ID. */
function uuidBytes(id: string): Uint8Array {
  if (!UUID.test(id)) throw new Error("ID must be a UUID");
  const hex = id.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function checkLength(bytes: Uint8Array, length: number, name: string): void {
  if (bytes.length !== length) throw new Error(`${name} must be exactly ${length} bytes`);
}

/** Decodes base64url and refuses every spelling but the canonical one. */
function strictBase64url(text: string, error: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64url(text);
  } catch {
    throw new Error(error);
  }
  if (toBase64url(bytes) !== text) throw new Error(error);
  return bytes;
}

function hkdf(info: Uint8Array): HkdfParams {
  return { name: "HKDF", hash: "SHA-256", salt: asBytes(NO_SALT), info: asBytes(info) };
}

async function deriveToken(base: CryptoKey, info: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.deriveBits(hkdf(info), base, REQUEST_TOKEN_LENGTH * 8));
}

async function deriveAesKey(base: CryptoKey, info: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(hkdf(info), base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function aesGcm(
  mode: "encrypt" | "decrypt",
  key: CryptoKey,
  nonce: Uint8Array,
  aad: string,
  data: Uint8Array,
): Promise<Uint8Array> {
  const params = {
    name: "AES-GCM",
    iv: asBytes(nonce),
    additionalData: asBytes(encodeUtf8(aad)),
    tagLength: 128,
  };
  const out =
    mode === "encrypt"
      ? await crypto.subtle.encrypt(params, key, asBytes(data))
      : await crypto.subtle.decrypt(params, key, asBytes(data));
  return new Uint8Array(out);
}

/** The keys of the inbox link: the vault key and the tokens the server checks. */
export async function deriveInboxKeys(inboxSecret: Uint8Array): Promise<InboxKeys> {
  checkLength(inboxSecret, REQUEST_SECRET_LENGTH, "Inbox secret");
  const base = await importHkdfKey(inboxSecret);
  const [inboxKey, inboxAuthToken, inboxOwnerToken] = await Promise.all([
    deriveAesKey(base, encodeUtf8(INFO_INBOX_KEY)),
    deriveToken(base, encodeUtf8(INFO_INBOX_AUTH)),
    deriveToken(base, encodeUtf8(INFO_INBOX_OWNER)),
  ]);
  return { inboxKey, inboxAuthToken, inboxOwnerToken };
}

/**
 * The keys of the upload link: the token that lets a sender upload and the title key. Both
 * bind the public key, so a link with a swapped key yields a token the server rejects.
 */
export async function deriveLinkKeys(
  linkSecret: Uint8Array,
  publicKey: Uint8Array,
): Promise<LinkKeys> {
  checkLength(linkSecret, REQUEST_SECRET_LENGTH, "Link secret");
  assertUncompressedPoint(publicKey);
  const base = await importHkdfKey(linkSecret);
  const [uploadToken, titleKey] = await Promise.all([
    deriveToken(base, concatBytes(encodeUtf8(INFO_UPLOAD_TOKEN), publicKey)),
    deriveAesKey(base, concatBytes(encodeUtf8(INFO_TITLE_KEY), publicKey)),
  ]);
  return { uploadToken, titleKey };
}

/** Encrypts the title of a request. The server stores it without being able to read it. */
export async function encryptRequestTitle(
  title: string,
  titleKey: CryptoKey,
): Promise<EncryptedRequestTitle> {
  const bytes = encodeUtf8(title);
  if (bytes.length > REQUEST_TITLE_MAX_BYTES) {
    throw new Error(`Title must be at most ${REQUEST_TITLE_MAX_BYTES} bytes`);
  }
  const nonce = randomBytes(REQUEST_NONCE_LENGTH);
  return { ciphertext: await aesGcm("encrypt", titleKey, nonce, TITLE_AAD, bytes), nonce };
}

/** Decrypts the title of a request. Throws if it was changed or the key is wrong. */
export async function decryptRequestTitle(
  title: EncryptedRequestTitle,
  titleKey: CryptoKey,
): Promise<string> {
  checkLength(title.nonce, REQUEST_NONCE_LENGTH, "Title nonce");
  if (title.ciphertext.length > REQUEST_TITLE_MAX_CIPHERTEXT_LENGTH)
    throw new Error("Title is too long");
  return decodeUtf8(await aesGcm("decrypt", titleKey, title.nonce, TITLE_AAD, title.ciphertext));
}

/**
 * Creates a request: key pair, both secrets, the sealed vault, the tokens and the title.
 *
 * The private key is the one key in this package that is generated extractable, because it
 * has to be sealed into the vault once. Only its scalar leaves this function, inside the vault.
 */
export async function createFileRequest(options: { title?: string } = {}): Promise<NewFileRequest> {
  const inboxSecret = randomBytes(REQUEST_SECRET_LENGTH);
  const linkSecret = randomBytes(REQUEST_SECRET_LENGTH);

  const pair = (await crypto.subtle.generateKey(P256, true, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  // An exported EC private key always carries d, its length is checked right below.
  const scalar = fromBase64url(jwk.d!);
  checkLength(scalar, SCALAR_LENGTH, "Private key");

  const [inbox, link] = await Promise.all([
    deriveInboxKeys(inboxSecret),
    deriveLinkKeys(linkSecret, publicKey),
  ]);
  const plaintext = concatBytes(new Uint8Array([REQUEST_SUITE]), publicKey, linkSecret, scalar);
  scalar.fill(0);
  const vaultNonce = randomBytes(REQUEST_NONCE_LENGTH);
  const vault = await aesGcm("encrypt", inbox.inboxKey, vaultNonce, VAULT_AAD, plaintext);
  plaintext.fill(0);
  const title = options.title ? await encryptRequestTitle(options.title, link.titleKey) : null;

  return {
    local: { inboxSecret, linkSecret, publicKey },
    server: {
      vault,
      vaultNonce,
      inboxAuthToken: inbox.inboxAuthToken,
      inboxOwnerToken: inbox.inboxOwnerToken,
      uploadToken: link.uploadToken,
      title,
    },
  };
}

/** Opens the vault with the key of the inbox link. Throws if it was changed or the key is wrong. */
export async function openRequestKey(
  vault: Uint8Array,
  vaultNonce: Uint8Array,
  inboxKey: CryptoKey,
): Promise<RequestKey> {
  checkLength(vaultNonce, REQUEST_NONCE_LENGTH, "Vault nonce");
  checkLength(vault, REQUEST_VAULT_LENGTH, "Vault");
  const plaintext = await aesGcm("decrypt", inboxKey, vaultNonce, VAULT_AAD, vault);
  try {
    if (plaintext.length !== VAULT_PLAINTEXT_LENGTH || plaintext[0] !== REQUEST_SUITE) {
      throw new Error("Unsupported request vault");
    }
    const publicKey = plaintext.slice(1, 1 + HPKE_PUBLIC_KEY_LENGTH);
    const linkSecret = plaintext.slice(1 + HPKE_PUBLIC_KEY_LENGTH, UPLOAD_FRAGMENT_LENGTH);
    const scalar = plaintext.subarray(UPLOAD_FRAGMENT_LENGTH);
    assertUncompressedPoint(publicKey);
    const jwk: JsonWebKey = {
      kty: "EC",
      crv: "P-256",
      d: toBase64url(scalar),
      x: toBase64url(publicKey.subarray(1, 33)),
      y: toBase64url(publicKey.subarray(33, 65)),
    };
    const privateKey = await crypto.subtle.importKey("jwk", jwk, P256, false, ["deriveBits"]);
    return { publicKey, linkSecret, privateKey };
  } finally {
    plaintext.fill(0);
  }
}

function wrapInfo(requestId: string): Uint8Array {
  return concatBytes(encodeUtf8(HPKE_INFO), uuidBytes(requestId));
}

/** Wraps a file secret to the request's public key, bound to this request and upload. */
export async function wrapFileSecret(
  publicKey: Uint8Array,
  requestId: string,
  uploadId: string,
  fileSecret: Uint8Array,
): Promise<WrappedFileSecret> {
  checkLength(fileSecret, SECRET_LENGTH, "File secret");
  return sealBase(publicKey, wrapInfo(requestId), uuidBytes(uploadId), fileSecret);
}

/** Unwraps a file secret. Throws if the wrap belongs to another request or upload, or was changed. */
export async function unwrapFileSecret(
  key: RequestKey,
  requestId: string,
  uploadId: string,
  wrapped: WrappedFileSecret,
): Promise<Uint8Array> {
  checkLength(wrapped.enc, WRAP_ENC_LENGTH, "Wrapped key enc");
  checkLength(wrapped.ciphertext, WRAP_CIPHERTEXT_LENGTH, "Wrapped key ciphertext");
  return openBase(
    wrapped.enc,
    key.privateKey,
    key.publicKey,
    wrapInfo(requestId),
    uuidBytes(uploadId),
    wrapped.ciphertext,
  );
}

/** The fragment of the upload link: suite, public key and link secret. */
export function encodeUploadFragment(publicKey: Uint8Array, linkSecret: Uint8Array): string {
  assertUncompressedPoint(publicKey);
  checkLength(linkSecret, REQUEST_SECRET_LENGTH, "Link secret");
  return toBase64url(concatBytes(new Uint8Array([REQUEST_SUITE]), publicKey, linkSecret));
}

/**
 * Reads the fragment of an upload link, including whether the public key is a point on the
 * curve, so a broken link fails before anything is uploaded.
 */
export async function decodeUploadFragment(
  fragment: string,
): Promise<{ publicKey: Uint8Array; linkSecret: Uint8Array }> {
  const error = "Not a valid upload link";
  const bytes = strictBase64url(fragment, error);
  if (bytes.length !== UPLOAD_FRAGMENT_LENGTH || bytes[0] !== REQUEST_SUITE) throw new Error(error);
  const publicKey = bytes.slice(1, 1 + HPKE_PUBLIC_KEY_LENGTH);
  try {
    await importPublicKey(publicKey);
  } catch {
    throw new Error(error);
  }
  return { publicKey, linkSecret: bytes.slice(1 + HPKE_PUBLIC_KEY_LENGTH) };
}

/**
 * The fragment of the inbox link. `secret` is the inbox secret, or with a password the secret
 * after applyPasswordProtection(), and then `passwordSalt` goes along so the inbox needs no
 * endpoint that answers before the token is checked.
 */
export function encodeInboxFragment(secret: Uint8Array, passwordSalt?: Uint8Array): string {
  checkLength(secret, REQUEST_SECRET_LENGTH, "Inbox secret");
  if (passwordSalt) checkLength(passwordSalt, PASSWORD_SALT_LENGTH, "Password salt");
  return toBase64url(
    concatBytes(new Uint8Array([INBOX_FRAGMENT_VERSION]), secret, passwordSalt ?? NO_SALT),
  );
}

/** Reads the fragment of an inbox link. A password salt means the secret is password protected. */
export function decodeInboxFragment(fragment: string): {
  secret: Uint8Array;
  passwordSalt: Uint8Array | null;
} {
  const error = "Not a valid inbox link";
  const bytes = strictBase64url(fragment, error);
  const plain = 1 + REQUEST_SECRET_LENGTH;
  if (
    bytes[0] !== INBOX_FRAGMENT_VERSION ||
    (bytes.length !== plain && bytes.length !== plain + PASSWORD_SALT_LENGTH)
  ) {
    throw new Error(error);
  }
  return {
    secret: bytes.slice(1, plain),
    passwordSalt: bytes.length > plain ? bytes.slice(plain) : null,
  };
}
