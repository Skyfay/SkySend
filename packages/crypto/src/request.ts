/**
 * File requests: a requester asks for files or a note, senders drop them in, only the requester
 * reads them.
 *
 * The requester's browser makes a P-256 key pair and two secrets:
 *
 *   inboxSecret -> HKDF -> inboxKey (seals the private key), inboxAuthToken, inboxOwnerToken
 *   linkSecret  -> HKDF -> uploadToken (lets a sender upload), briefKey (the request's brief)
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
 * brief key also take the public key, so a link rewritten with another key is rejected.
 *
 * Every request carries a brief: what the requester asks for, an optional title, and an
 * optional note template for the sender to fill in. It is versioned JSON, padded so its
 * length tells little, and encrypted with the brief key, so a sender reads it from the link
 * and the server never does. A server that drops it shows the sender a broken request
 * rather than a quiet one without a brief.
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
 *   vault            AES-256-GCM(inboxKey, nonce 12 B, aad "skysend-inbox-privkey-v1"
 *                    || SHA-256(brief nonce || brief ciphertext)), 146 B
 *   wrap             HPKE base, info "skysend-request-v1" || requestId 16 B, aad uploadId 16 B,
 *                    plaintext the 32-byte file secret, stored as enc 65 B and ciphertext 48 B
 *   brief plaintext  UTF-8 {"v":1,"title":string|null,"asks":["files"|"note",...],
 *                    "template":object|null}, padded with spaces to a multiple of 1 KiB,
 *                    at most 8 KiB
 *   brief            AES-256-GCM(briefKey, nonce 12 B, aad "skysend-request-brief-v1")
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

/** Length of the vault nonce and the brief nonce. */
export const REQUEST_NONCE_LENGTH = 12;

/** Length of inboxAuthToken, inboxOwnerToken and uploadToken. */
export const REQUEST_TOKEN_LENGTH = 32;

/** Length of the sealed vault. */
export const REQUEST_VAULT_LENGTH = 1 + HPKE_PUBLIC_KEY_LENGTH + REQUEST_SECRET_LENGTH + 32 + 16;

/** The longest title in UTF-8 bytes. */
export const REQUEST_TITLE_MAX_BYTES = 256;

/** A brief is padded to a multiple of this many bytes. */
export const REQUEST_BRIEF_BLOCK = 1024;
/** The longest brief in bytes, padding included, and the longest brief ciphertext. */
export const REQUEST_BRIEF_MAX_BYTES = 8 * REQUEST_BRIEF_BLOCK;
export const REQUEST_BRIEF_MAX_CIPHERTEXT_LENGTH = REQUEST_BRIEF_MAX_BYTES + 16;
/** The shortest brief ciphertext: one padded block and the tag. */
export const REQUEST_BRIEF_MIN_CIPHERTEXT_LENGTH = REQUEST_BRIEF_BLOCK + 16;

/**
 * The version of the brief this package writes. It only goes up for a change a reader of
 * this version has to refuse. Fields and asks added later are fine without it: a reader
 * leaves out the fields it does not know, and the asks too, as long as one it knows is left.
 */
const BRIEF_VERSION = 1;

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
const INFO_BRIEF_KEY = "skysend-request-brief";
const HPKE_INFO = "skysend-request-v1";
const VAULT_AAD = "skysend-inbox-privkey-v1";
const BRIEF_AAD = "skysend-request-brief-v1";

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

/** Keys derived from linkSecret and the public key. briefKey cannot be exported. */
export interface LinkKeys {
  uploadToken: Uint8Array;
  briefKey: CryptoKey;
}

/** What a requester asks senders for. */
export type RequestAsk = "files" | "note";
const ASKS: readonly RequestAsk[] = ["files", "note"];

/**
 * The brief of a request, what a sender sees before sending. The template is a note
 * template as @skysend/note-format writes it. This package only checks that it is an object,
 * the reader validates the rest.
 */
export interface RequestBrief {
  title: string | null;
  /** At least one, each at most once. */
  asks: RequestAsk[];
  template: Record<string, unknown> | null;
}

/** An encrypted brief. */
export interface EncryptedRequestBrief {
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
  brief: EncryptedRequestBrief;
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
  aad: string | Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const params = {
    name: "AES-GCM",
    iv: asBytes(nonce),
    additionalData: asBytes(typeof aad === "string" ? encodeUtf8(aad) : aad),
    tagLength: 128,
  };
  const out =
    mode === "encrypt"
      ? await crypto.subtle.encrypt(params, key, asBytes(data))
      : await crypto.subtle.decrypt(params, key, asBytes(data));
  return new Uint8Array(out);
}

/**
 * The AAD of the vault. It binds the brief the server stores, so a server that swaps or
 * drops the brief breaks the vault instead of showing the requester a brief they never wrote.
 */
async function vaultAad(brief: EncryptedRequestBrief): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    asBytes(concatBytes(brief.nonce, brief.ciphertext)),
  );
  return concatBytes(encodeUtf8(VAULT_AAD), new Uint8Array(digest));
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
 * The keys of the upload link: the token that lets a sender upload and the brief key. Both
 * bind the public key, so a link with a swapped key yields a token the server rejects.
 */
export async function deriveLinkKeys(
  linkSecret: Uint8Array,
  publicKey: Uint8Array,
): Promise<LinkKeys> {
  checkLength(linkSecret, REQUEST_SECRET_LENGTH, "Link secret");
  assertUncompressedPoint(publicKey);
  const base = await importHkdfKey(linkSecret);
  const [uploadToken, briefKey] = await Promise.all([
    deriveToken(base, concatBytes(encodeUtf8(INFO_UPLOAD_TOKEN), publicKey)),
    deriveAesKey(base, concatBytes(encodeUtf8(INFO_BRIEF_KEY), publicKey)),
  ]);
  return { uploadToken, briefKey };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks a brief and brings it into one form: an empty title becomes null, the asks keep the
 * order of ASKS, and a template without a note to fill in is left out. Throws for anything a
 * reader of this version would not understand.
 */
function checkBrief(brief: RequestBrief): RequestBrief {
  const title = brief.title === "" ? null : brief.title;
  if (title !== null && typeof title !== "string") throw new Error("Brief title must be text");
  if (title !== null && encodeUtf8(title).length > REQUEST_TITLE_MAX_BYTES) {
    throw new Error(`Title must be at most ${REQUEST_TITLE_MAX_BYTES} bytes`);
  }
  if (!Array.isArray(brief.asks) || brief.asks.length === 0) {
    throw new Error("A brief asks for at least one thing");
  }
  if (
    brief.asks.some((ask) => !ASKS.includes(ask)) ||
    new Set(brief.asks).size !== brief.asks.length
  ) {
    throw new Error("A brief asks for files or a note, each once");
  }
  if (brief.template !== null && !isRecord(brief.template)) {
    throw new Error("Brief template must be an object");
  }
  const asks = ASKS.filter((ask) => brief.asks.includes(ask));
  return { title, asks, template: asks.includes("note") ? brief.template : null };
}

/** Whether a brief ciphertext has a length a writer of this version produces. */
function checkBriefLength(brief: EncryptedRequestBrief): void {
  checkLength(brief.nonce, REQUEST_NONCE_LENGTH, "Brief nonce");
  const length = brief.ciphertext.length;
  if (
    length < REQUEST_BRIEF_MIN_CIPHERTEXT_LENGTH ||
    length > REQUEST_BRIEF_MAX_CIPHERTEXT_LENGTH ||
    (length - 16) % REQUEST_BRIEF_BLOCK !== 0
  ) {
    throw new Error("Brief has the wrong length");
  }
}

/** The brief as bytes: versioned JSON, padded with spaces to a multiple of a block. */
function encodeBrief(brief: RequestBrief): Uint8Array {
  const { title, asks, template } = checkBrief(brief);
  const json = encodeUtf8(JSON.stringify({ v: BRIEF_VERSION, title, asks, template }));
  const padded = Math.max(1, Math.ceil(json.length / REQUEST_BRIEF_BLOCK)) * REQUEST_BRIEF_BLOCK;
  if (padded > REQUEST_BRIEF_MAX_BYTES) {
    throw new Error(`A brief must be at most ${REQUEST_BRIEF_MAX_BYTES} bytes`);
  }
  const bytes = new Uint8Array(padded).fill(0x20);
  bytes.set(json);
  return bytes;
}

/** Reads a decrypted brief. Throws for anything but a brief this version can read. */
function decodeBrief(bytes: Uint8Array): RequestBrief {
  let data: unknown;
  try {
    data = JSON.parse(decodeUtf8(bytes));
  } catch {
    throw new Error("Not a valid request brief");
  }
  if (!isRecord(data) || data.v !== BRIEF_VERSION) throw new Error("Unsupported request brief");
  const title = data.title ?? null;
  if (title !== null && typeof title !== "string") throw new Error("Not a valid request brief");
  if (!Array.isArray(data.asks)) throw new Error("Not a valid request brief");
  // An ask from a later version is left out, see BRIEF_VERSION.
  const asks = data.asks.filter((ask): ask is RequestAsk => ASKS.includes(ask as RequestAsk));
  const template = data.template ?? null;
  try {
    return checkBrief({ title, asks, template: template as Record<string, unknown> | null });
  } catch {
    throw new Error("Not a valid request brief");
  }
}

/** Encrypts the brief of a request. The server stores it without being able to read it. */
export async function encryptRequestBrief(
  brief: RequestBrief,
  briefKey: CryptoKey,
): Promise<EncryptedRequestBrief> {
  const plaintext = encodeBrief(brief);
  const nonce = randomBytes(REQUEST_NONCE_LENGTH);
  return { ciphertext: await aesGcm("encrypt", briefKey, nonce, BRIEF_AAD, plaintext), nonce };
}

/** Decrypts and reads the brief of a request. Throws if it was changed or the key is wrong. */
export async function decryptRequestBrief(
  brief: EncryptedRequestBrief,
  briefKey: CryptoKey,
): Promise<RequestBrief> {
  checkBriefLength(brief);
  return decodeBrief(await aesGcm("decrypt", briefKey, brief.nonce, BRIEF_AAD, brief.ciphertext));
}

/**
 * Creates a request: key pair, both secrets, the sealed vault, the tokens and the brief. A
 * brief left out asks for files, with no title and no template.
 *
 * The private key is the one key in this package that is generated extractable, because it
 * has to be sealed into the vault once. Only its scalar leaves this function, inside the vault.
 */
export async function createFileRequest(
  brief: Partial<RequestBrief> = {},
): Promise<NewFileRequest> {
  const checked = checkBrief({
    title: brief.title ?? null,
    asks: brief.asks ?? ["files"],
    template: brief.template ?? null,
  });
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
  const encryptedBrief = await encryptRequestBrief(checked, link.briefKey);
  const plaintext = concatBytes(new Uint8Array([REQUEST_SUITE]), publicKey, linkSecret, scalar);
  scalar.fill(0);
  const vaultNonce = randomBytes(REQUEST_NONCE_LENGTH);
  const vault = await aesGcm(
    "encrypt",
    inbox.inboxKey,
    vaultNonce,
    await vaultAad(encryptedBrief),
    plaintext,
  );
  plaintext.fill(0);

  return {
    local: { inboxSecret, linkSecret, publicKey },
    server: {
      vault,
      vaultNonce,
      inboxAuthToken: inbox.inboxAuthToken,
      inboxOwnerToken: inbox.inboxOwnerToken,
      uploadToken: link.uploadToken,
      brief: encryptedBrief,
    },
  };
}

/**
 * Opens the vault with the key of the inbox link and the brief as the server stores it.
 * Throws if either was changed or the key is wrong.
 */
export async function openRequestKey(
  vault: Uint8Array,
  vaultNonce: Uint8Array,
  inboxKey: CryptoKey,
  brief: EncryptedRequestBrief,
): Promise<RequestKey> {
  checkLength(vaultNonce, REQUEST_NONCE_LENGTH, "Vault nonce");
  checkLength(vault, REQUEST_VAULT_LENGTH, "Vault");
  // The AAD hashes nonce and ciphertext together, so their split has to be the one written.
  checkBriefLength(brief);
  const plaintext = await aesGcm("decrypt", inboxKey, vaultNonce, await vaultAad(brief), vault);
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
