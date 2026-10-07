import { describe, expect, it, vi } from "vitest";
import {
  openWithPassword,
  PASSWORD_BOX_ARGON2,
  PASSWORD_BOX_NONCE_LENGTH,
  sealWithPassword,
} from "../src/password-box.js";
import { ARGON2_PARAMS, PASSWORD_SALT_LENGTH, type Argon2idHashFn } from "../src/password.js";
import { asBytes, concatBytes, encodeUtf8 } from "../src/util.js";
import { flipped } from "./helpers.js";

/** A stand-in for Argon2id: SHA-256 of password and salt, so it is fast and deterministic. */
const fakeArgon2: Argon2idHashFn = async (password, salt) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", asBytes(concatBytes(password, salt))));

const PURPOSE = "skysend-test-v1";
const plaintext = encodeUtf8('{"templates":[]}');

describe("password box", () => {
  it("should open what it sealed with the same password and purpose", async () => {
    const box = await sealWithPassword(plaintext, "correct horse", PURPOSE, fakeArgon2);
    expect(box.salt.length).toBe(PASSWORD_SALT_LENGTH);
    expect(box.nonce.length).toBe(PASSWORD_BOX_NONCE_LENGTH);
    expect(box.ciphertext.length).toBe(plaintext.length + 16);
    expect(await openWithPassword(box, "correct horse", PURPOSE, fakeArgon2)).toEqual(plaintext);
  });

  it("should derive the key with frozen parameters that match an upload password", async () => {
    const argon2 = vi.fn(fakeArgon2);
    await sealWithPassword(plaintext, "pw", PURPOSE, argon2);
    expect(argon2).toHaveBeenCalledWith(encodeUtf8("pw"), expect.any(Uint8Array), {
      memory: 65_536,
      iterations: 3,
      parallelism: 1,
      hashLength: 32,
    });
    expect(PASSWORD_BOX_ARGON2).toEqual(ARGON2_PARAMS);
  });

  it("should use a fresh salt and nonce for every seal", async () => {
    const a = await sealWithPassword(plaintext, "pw", PURPOSE, fakeArgon2);
    const b = await sealWithPassword(plaintext, "pw", PURPOSE, fakeArgon2);
    expect(a.salt).not.toEqual(b.salt);
    expect(a.nonce).not.toEqual(b.nonce);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it("should refuse a wrong password", async () => {
    const box = await sealWithPassword(plaintext, "pw", PURPOSE, fakeArgon2);
    await expect(openWithPassword(box, "pW", PURPOSE, fakeArgon2)).rejects.toThrow();
  });

  it("should refuse a box sealed for another purpose", async () => {
    const box = await sealWithPassword(plaintext, "pw", PURPOSE, fakeArgon2);
    await expect(openWithPassword(box, "pw", "skysend-other-v1", fakeArgon2)).rejects.toThrow();
  });

  it("should refuse a box whose ciphertext, tag, nonce or salt was changed", async () => {
    const box = await sealWithPassword(plaintext, "pw", PURPOSE, fakeArgon2);
    const last = box.ciphertext.length - 1;
    for (const changed of [
      { ...box, ciphertext: flipped(box.ciphertext, 0) },
      { ...box, ciphertext: flipped(box.ciphertext, last) },
      { ...box, nonce: flipped(box.nonce, 0) },
      { ...box, salt: flipped(box.salt, 0) },
    ]) {
      await expect(openWithPassword(changed, "pw", PURPOSE, fakeArgon2)).rejects.toThrow();
    }
  });

  it("should refuse a nonce, a salt or a ciphertext of the wrong length", async () => {
    const box = await sealWithPassword(plaintext, "pw", PURPOSE, fakeArgon2);
    await expect(
      openWithPassword({ ...box, nonce: box.nonce.slice(1) }, "pw", PURPOSE, fakeArgon2),
    ).rejects.toThrow("nonce must be exactly 12 bytes");
    await expect(
      openWithPassword({ ...box, salt: box.salt.slice(1) }, "pw", PURPOSE, fakeArgon2),
    ).rejects.toThrow("salt must be exactly 16 bytes");
    await expect(
      openWithPassword(
        { ...box, ciphertext: box.ciphertext.slice(0, 15) },
        "pw",
        PURPOSE,
        fakeArgon2,
      ),
    ).rejects.toThrow("too short");
  });

  it("should refuse an empty password", async () => {
    await expect(sealWithPassword(plaintext, "", PURPOSE, fakeArgon2)).rejects.toThrow(
      "Password must not be empty",
    );
  });
});
