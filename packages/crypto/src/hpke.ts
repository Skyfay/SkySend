/**
 * HPKE in base mode, single-shot (RFC 9180), for exactly one suite:
 *
 *   KEM  DHKEM(P-256, HKDF-SHA256)  0x0010
 *   KDF  HKDF-SHA256                0x0001
 *   AEAD AES-256-GCM                0x0002
 *
 * File requests use it to wrap a file secret to the public key of a requester. Every wrap is
 * one seal with a fresh ephemeral key, so only sequence number 0 of the RFC's context exists
 * here and there is no context object to reuse by mistake.
 *
 * The KEM feeds the ephemeral and the recipient public key into the shared secret
 * (kem_context = enc || pkRm). That matters for P-256: ECDH only yields the x-coordinate,
 * so the negated ephemeral point gives the same DH output, and only the binding makes a
 * changed enc fail.
 *
 * Web Crypto only: ECDH for the DH, HMAC-SHA256 for LabeledExtract and LabeledExpand, AES-GCM
 * for the AEAD. tests/hpke.test.ts checks every step against the CFRG test vectors.
 */

import { asBytes, concatBytes, encodeUtf8 } from "./util.js";

const KEM_ID = 0x0010;
const KDF_ID = 0x0001;
const AEAD_ID = 0x0002;

/** Length of a serialized P-256 public key and of enc: an uncompressed point. */
export const HPKE_PUBLIC_KEY_LENGTH = 65;

const N_SECRET = 32;
const N_K = 32;
const N_N = 12;
const N_H = 32;
const MODE_BASE = 0x00;

const EMPTY = new Uint8Array(0);
const VERSION = encodeUtf8("HPKE-v1");
/** The Web Crypto algorithm of the KEM. */
export const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

function i2osp(value: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = length - 1, v = value; i >= 0; i--, v >>>= 8) out[i] = v & 0xff;
  return out;
}

const KEM_SUITE_ID = concatBytes(encodeUtf8("KEM"), i2osp(KEM_ID, 2));
const HPKE_SUITE_ID = concatBytes(
  encodeUtf8("HPKE"),
  i2osp(KEM_ID, 2),
  i2osp(KDF_ID, 2),
  i2osp(AEAD_ID, 2),
);

/** A P-256 key pair whose private half can only derive bits. */
export interface EphemeralKeyPair {
  privateKey: CryptoKey;
  publicKey: Uint8Array;
}

/** HMAC-SHA256. An empty key equals HashLen zero bytes, which is HKDF's default salt. */
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    "raw",
    asBytes(key.length > 0 ? key : new Uint8Array(N_H)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, asBytes(data)));
}

async function labeledExtract(
  suiteId: Uint8Array,
  salt: Uint8Array,
  label: string,
  ikm: Uint8Array,
): Promise<Uint8Array> {
  return hmac(salt, concatBytes(VERSION, suiteId, encodeUtf8(label), ikm));
}

async function labeledExpand(
  suiteId: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const labeledInfo = concatBytes(i2osp(length, 2), VERSION, suiteId, encodeUtf8(label), info);
  const out = new Uint8Array(length);
  let block: Uint8Array = EMPTY;
  for (let counter = 1, filled = 0; filled < length; counter++) {
    block = await hmac(prk, concatBytes(block, labeledInfo, new Uint8Array([counter])));
    out.set(block.subarray(0, length - filled), filled);
    filled += block.length;
  }
  return out;
}

/**
 * Rejects anything but an uncompressed P-256 point before Web Crypto sees it. Web Crypto
 * then rejects a point that is not on the curve.
 */
export function assertUncompressedPoint(point: Uint8Array): void {
  if (point.length !== HPKE_PUBLIC_KEY_LENGTH || point[0] !== 0x04) {
    throw new Error("Public key must be an uncompressed P-256 point");
  }
}

/** Imports a serialized P-256 public key. */
export async function importPublicKey(point: Uint8Array): Promise<CryptoKey> {
  assertUncompressedPoint(point);
  return crypto.subtle.importKey("raw", asBytes(point), P256, false, []);
}

/** A fresh ephemeral key pair. Its private key cannot be exported. */
export async function generateEphemeralKeyPair(): Promise<EphemeralKeyPair> {
  const pair = (await crypto.subtle.generateKey(P256, false, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKey };
}

async function dh(privateKey: CryptoKey, point: Uint8Array): Promise<Uint8Array> {
  const publicKey = await importPublicKey(point);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256),
  );
}

// Intermediate secrets are cleared after use. JavaScript cannot promise that no copy remains,
// so this is best effort.
async function extractAndExpand(dhOutput: Uint8Array, kemContext: Uint8Array): Promise<Uint8Array> {
  const eaePrk = await labeledExtract(KEM_SUITE_ID, EMPTY, "eae_prk", dhOutput);
  try {
    return await labeledExpand(KEM_SUITE_ID, eaePrk, "shared_secret", kemContext, N_SECRET);
  } finally {
    eaePrk.fill(0);
    dhOutput.fill(0);
  }
}

/** Encap(pkR) of RFC 9180 section 4.1, with the ephemeral key passed in. Exported for tests. */
export async function encap(
  recipientPublicKey: Uint8Array,
  ephemeral: EphemeralKeyPair,
): Promise<{ sharedSecret: Uint8Array; enc: Uint8Array }> {
  assertUncompressedPoint(recipientPublicKey);
  const dhOutput = await dh(ephemeral.privateKey, recipientPublicKey);
  const enc = ephemeral.publicKey;
  return {
    sharedSecret: await extractAndExpand(dhOutput, concatBytes(enc, recipientPublicKey)),
    enc,
  };
}

/** Decap(enc, skR) of RFC 9180 section 4.1. pkR is the serialized public key of skR. */
export async function decap(
  enc: Uint8Array,
  recipientPrivateKey: CryptoKey,
  recipientPublicKey: Uint8Array,
): Promise<Uint8Array> {
  assertUncompressedPoint(recipientPublicKey);
  const dhOutput = await dh(recipientPrivateKey, enc);
  return extractAndExpand(dhOutput, concatBytes(enc, recipientPublicKey));
}

/** KeySchedule of RFC 9180 section 5.1 in base mode. Exported for tests. */
export async function keySchedule(
  sharedSecret: Uint8Array,
  info: Uint8Array,
): Promise<{ context: Uint8Array; secret: Uint8Array; key: Uint8Array; baseNonce: Uint8Array }> {
  const pskIdHash = await labeledExtract(HPKE_SUITE_ID, EMPTY, "psk_id_hash", EMPTY);
  const infoHash = await labeledExtract(HPKE_SUITE_ID, EMPTY, "info_hash", info);
  const context = concatBytes(new Uint8Array([MODE_BASE]), pskIdHash, infoHash);
  const secret = await labeledExtract(HPKE_SUITE_ID, sharedSecret, "secret", EMPTY);
  const key = await labeledExpand(HPKE_SUITE_ID, secret, "key", context, N_K);
  const baseNonce = await labeledExpand(HPKE_SUITE_ID, secret, "base_nonce", context, N_N);
  return { context, secret, key, baseNonce };
}

async function aesKey(key: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asBytes(key), "AES-GCM", false, [usage]);
}

/**
 * Seals one message to a recipient public key. Returns enc, the ephemeral public key, and
 * the ciphertext with its tag. `ephemeral` exists for the test vectors only.
 */
export async function sealBase(
  recipientPublicKey: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
  ephemeral?: EphemeralKeyPair,
): Promise<{ enc: Uint8Array; ciphertext: Uint8Array }> {
  const { sharedSecret, enc } = await encap(
    recipientPublicKey,
    ephemeral ?? (await generateEphemeralKeyPair()),
  );
  const { key, baseNonce, secret } = await keySchedule(sharedSecret, info);
  sharedSecret.fill(0);
  secret.fill(0);
  const cryptoKey = await aesKey(key, "encrypt");
  key.fill(0);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBytes(baseNonce), additionalData: asBytes(aad), tagLength: 128 },
    cryptoKey,
    asBytes(plaintext),
  );
  return { enc, ciphertext: new Uint8Array(ciphertext) };
}

/** Opens a message sealed with sealBase. Throws when anything was changed. */
export async function openBase(
  enc: Uint8Array,
  recipientPrivateKey: CryptoKey,
  recipientPublicKey: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const sharedSecret = await decap(enc, recipientPrivateKey, recipientPublicKey);
  const { key, baseNonce, secret } = await keySchedule(sharedSecret, info);
  sharedSecret.fill(0);
  secret.fill(0);
  const cryptoKey = await aesKey(key, "decrypt");
  key.fill(0);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBytes(baseNonce), additionalData: asBytes(aad), tagLength: 128 },
    cryptoKey,
    asBytes(ciphertext),
  );
  return new Uint8Array(plaintext);
}
