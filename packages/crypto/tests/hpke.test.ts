import { describe, expect, it } from "vitest";
import {
  decap,
  encap,
  generateEphemeralKeyPair,
  importPublicKey,
  keySchedule,
  openBase,
  sealBase,
  type EphemeralKeyPair,
} from "../src/hpke.js";
import { randomBytes, toBase64url } from "../src/util.js";
import { fromHex, negate, P256_PRIME, toHex } from "./helpers.js";
import vectors from "./fixtures/hpke-p256-sha256-aes256gcm.json";

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

async function importPrivate(skHex: string, pkHex: string): Promise<CryptoKey> {
  const pk = fromHex(pkHex);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: toBase64url(fromHex(skHex)),
    x: toBase64url(pk.slice(1, 33)),
    y: toBase64url(pk.slice(33, 65)),
  };
  return crypto.subtle.importKey("jwk", jwk, P256, false, ["deriveBits"]);
}

async function vectorEphemeral(): Promise<EphemeralKeyPair> {
  return {
    privateKey: await importPrivate(vectors.skEm, vectors.pkEm),
    publicKey: fromHex(vectors.pkEm),
  };
}

async function recipient(): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array }> {
  const pair = (await crypto.subtle.generateKey(P256, false, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKey };
}

const info = fromHex(vectors.info);
const aad = fromHex(vectors.encryption.aad);
const pt = fromHex(vectors.encryption.pt);

describe("HPKE against the CFRG test vectors", () => {
  it("should encapsulate to the vector's enc and shared secret", async () => {
    const { sharedSecret, enc } = await encap(fromHex(vectors.pkRm), await vectorEphemeral());
    expect(toHex(enc)).toBe(vectors.enc);
    expect(toHex(sharedSecret)).toBe(vectors.shared_secret);
  });

  it("should decapsulate to the vector's shared secret", async () => {
    const skR = await importPrivate(vectors.skRm, vectors.pkRm);
    expect(toHex(await decap(fromHex(vectors.enc), skR, fromHex(vectors.pkRm)))).toBe(
      vectors.shared_secret,
    );
  });

  it("should derive the vector's key schedule", async () => {
    const schedule = await keySchedule(fromHex(vectors.shared_secret), info);
    expect(toHex(schedule.context)).toBe(vectors.key_schedule_context);
    expect(toHex(schedule.secret)).toBe(vectors.secret);
    expect(toHex(schedule.key)).toBe(vectors.key);
    expect(toHex(schedule.baseNonce)).toBe(vectors.base_nonce);
    expect(vectors.encryption.nonce).toBe(vectors.base_nonce);
  });

  it("should seal to the vector's ciphertext", async () => {
    const sealed = await sealBase(fromHex(vectors.pkRm), info, aad, pt, await vectorEphemeral());
    expect(toHex(sealed.enc)).toBe(vectors.enc);
    expect(toHex(sealed.ciphertext)).toBe(vectors.encryption.ct);
  });

  it("should open the vector's ciphertext", async () => {
    const skR = await importPrivate(vectors.skRm, vectors.pkRm);
    const opened = await openBase(
      fromHex(vectors.enc),
      skR,
      fromHex(vectors.pkRm),
      info,
      aad,
      fromHex(vectors.encryption.ct),
    );
    expect(toHex(opened)).toBe(vectors.encryption.pt);
  });
});

describe("HPKE seal and open", () => {
  it("should round-trip with a fresh ephemeral key each time", async () => {
    const r = await recipient();
    const message = randomBytes(32);
    const first = await sealBase(r.publicKey, info, aad, message);
    const second = await sealBase(r.publicKey, info, aad, message);
    expect(toHex(first.enc)).not.toBe(toHex(second.enc));
    expect(toHex(first.ciphertext)).not.toBe(toHex(second.ciphertext));
    expect(
      await openBase(first.enc, r.privateKey, r.publicKey, info, aad, first.ciphertext),
    ).toEqual(message);
    expect(
      await openBase(second.enc, r.privateKey, r.publicKey, info, aad, second.ciphertext),
    ).toEqual(message);
  });

  it("should round-trip an empty message", async () => {
    const r = await recipient();
    const sealed = await sealBase(r.publicKey, info, aad, new Uint8Array(0));
    expect(sealed.ciphertext.length).toBe(16);
    expect(
      await openBase(sealed.enc, r.privateKey, r.publicKey, info, aad, sealed.ciphertext),
    ).toEqual(new Uint8Array(0));
  });

  it("should reject a changed ciphertext, tag, info or aad", async () => {
    const r = await recipient();
    const sealed = await sealBase(r.publicKey, info, aad, pt);
    const flipped = (bytes: Uint8Array, index: number) => {
      const copy = new Uint8Array(bytes);
      copy[index]! ^= 0x01;
      return copy;
    };
    await expect(
      openBase(sealed.enc, r.privateKey, r.publicKey, info, aad, flipped(sealed.ciphertext, 0)),
    ).rejects.toThrow();
    await expect(
      openBase(
        sealed.enc,
        r.privateKey,
        r.publicKey,
        info,
        aad,
        flipped(sealed.ciphertext, sealed.ciphertext.length - 1),
      ),
    ).rejects.toThrow();
    await expect(
      openBase(sealed.enc, r.privateKey, r.publicKey, flipped(info, 0), aad, sealed.ciphertext),
    ).rejects.toThrow();
    await expect(
      openBase(sealed.enc, r.privateKey, r.publicKey, info, flipped(aad, 0), sealed.ciphertext),
    ).rejects.toThrow();
  });

  it("should reject the negated ephemeral key, which gives the same ECDH output", async () => {
    const r = await recipient();
    const sealed = await sealBase(r.publicKey, info, aad, pt);
    const negated = negate(sealed.enc);
    expect(toHex(negated)).not.toBe(toHex(sealed.enc));
    // The negated point is valid and yields the same DH bits, only the KEM binding catches it.
    const publicKey = await importPublicKey(negated);
    const dhOriginal = await crypto.subtle.deriveBits(
      { name: "ECDH", public: await importPublicKey(sealed.enc) },
      r.privateKey,
      256,
    );
    const dhNegated = await crypto.subtle.deriveBits(
      { name: "ECDH", public: publicKey },
      r.privateKey,
      256,
    );
    expect(new Uint8Array(dhNegated)).toEqual(new Uint8Array(dhOriginal));
    await expect(
      openBase(negated, r.privateKey, r.publicKey, info, aad, sealed.ciphertext),
    ).rejects.toThrow();
  });

  it("should reject a message for another recipient", async () => {
    const r = await recipient();
    const other = await recipient();
    const sealed = await sealBase(r.publicKey, info, aad, pt);
    await expect(
      openBase(sealed.enc, other.privateKey, other.publicKey, info, aad, sealed.ciphertext),
    ).rejects.toThrow();
    // The right private key with a wrong public key in the KEM context fails as well.
    await expect(
      openBase(sealed.enc, r.privateKey, other.publicKey, info, aad, sealed.ciphertext),
    ).rejects.toThrow();
  });
});

describe("HPKE public keys", () => {
  it("should accept an uncompressed P-256 point", async () => {
    const ephemeral = await generateEphemeralKeyPair();
    expect(ephemeral.publicKey.length).toBe(65);
    expect(ephemeral.publicKey[0]).toBe(0x04);
    await expect(importPublicKey(ephemeral.publicKey)).resolves.toBeDefined();
    await expect(crypto.subtle.exportKey("pkcs8", ephemeral.privateKey)).rejects.toThrow();
  });

  it("should reject points of the wrong length or form", async () => {
    const { publicKey } = await generateEphemeralKeyPair();
    const compressed = new Uint8Array([0x02 | (publicKey[64]! & 1), ...publicKey.slice(1, 33)]);
    await expect(importPublicKey(compressed)).rejects.toThrow("uncompressed P-256 point");
    await expect(importPublicKey(publicKey.slice(0, 64))).rejects.toThrow(
      "uncompressed P-256 point",
    );
    // Hybrid encodings, which Node's raw import would otherwise accept.
    for (const prefix of [0x05, 0x06, 0x07]) {
      await expect(
        importPublicKey(new Uint8Array([prefix, ...publicKey.slice(1)])),
      ).rejects.toThrow("uncompressed P-256 point");
    }
    await expect(sealBase(compressed, info, aad, pt)).rejects.toThrow("uncompressed P-256 point");
  });

  it("should reject a point that is not on the curve", async () => {
    const { publicKey } = await generateEphemeralKeyPair();
    const offCurve = new Uint8Array(publicKey);
    offCurve[64]! ^= 0x01;
    await expect(importPublicKey(offCurve)).rejects.toThrow();
    await expect(importPublicKey(new Uint8Array([0x04, ...new Uint8Array(64)]))).rejects.toThrow();
    // A coordinate at or above the field prime is not a field element.
    const xAtPrime = new Uint8Array([
      0x04,
      ...fromHex(P256_PRIME.toString(16)),
      ...publicKey.slice(33),
    ]);
    await expect(importPublicKey(xAtPrime)).rejects.toThrow();
    await expect(importPublicKey(new Uint8Array(65).fill(0xff).fill(0x04, 0, 1))).rejects.toThrow();
    const r = await recipient();
    await expect(sealBase(offCurve, info, aad, pt)).rejects.toThrow();
    await expect(decap(offCurve, r.privateKey, r.publicKey)).rejects.toThrow();
  });
});
