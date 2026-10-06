import { describe, expect, it } from "vitest";
import {
  applyPasswordProtection,
  computeAuthToken,
  computeOwnerToken,
  createFileRequest,
  decodeInboxFragment,
  decodeUploadFragment,
  decryptMetadata,
  decryptRequestTitle,
  deriveInboxKeys,
  deriveKeys,
  deriveLinkKeys,
  encodeInboxFragment,
  encodeUploadFragment,
  encryptMetadata,
  encryptRequestTitle,
  generateSecret,
  openRequestKey,
  randomBytes,
  toBase64url,
  unwrapFileSecret,
  wrapFileSecret,
  REQUEST_SUITE,
  REQUEST_TITLE_MAX_BYTES,
  REQUEST_VAULT_LENGTH,
  WRAP_CIPHERTEXT_LENGTH,
  WRAP_ENC_LENGTH,
  type NewFileRequest,
  type RequestKey,
  type WrappedFileSecret,
} from "../src/index.js";
import { flipped, fromHex, negate, toHex } from "./helpers.js";
import fixture from "./fixtures/file-request.json";

const requestId = crypto.randomUUID();
const uploadId = crypto.randomUUID();

/** A fresh request and its opened vault, the way the requester's browser holds it. */
async function freshRequest(title?: string): Promise<{ request: NewFileRequest; key: RequestKey }> {
  const request = await createFileRequest({ title });
  const { inboxKey } = await deriveInboxKeys(request.local.inboxSecret);
  return {
    request,
    key: await openRequestKey(
      request.server.vault,
      request.server.vaultNonce,
      inboxKey,
      request.server.title,
    ),
  };
}

describe("the frozen file request fixture", () => {
  const input = fixture.inputs;
  const output = fixture.outputs;
  const publicKey = fromHex(input.publicKey);

  it("should derive the frozen tokens", async () => {
    const inbox = await deriveInboxKeys(fromHex(input.inboxSecret));
    const link = await deriveLinkKeys(fromHex(input.linkSecret), publicKey);
    expect(toHex(inbox.inboxAuthToken)).toBe(output.inboxAuthToken);
    expect(toHex(inbox.inboxOwnerToken)).toBe(output.inboxOwnerToken);
    expect(toHex(link.uploadToken)).toBe(output.uploadToken);
  });

  it("should encode and decode the frozen upload fragment", async () => {
    expect(encodeUploadFragment(publicKey, fromHex(input.linkSecret))).toBe(output.uploadFragment);
    const decoded = await decodeUploadFragment(output.uploadFragment);
    expect(toHex(decoded.publicKey)).toBe(input.publicKey);
    expect(toHex(decoded.linkSecret)).toBe(input.linkSecret);
  });

  it("should encode and decode the frozen inbox fragments", () => {
    expect(encodeInboxFragment(fromHex(input.inboxSecret))).toBe(output.inboxFragment);
    expect(encodeInboxFragment(fromHex(input.inboxSecret), fromHex(input.passwordSalt))).toBe(
      output.inboxFragmentWithPassword,
    );
    expect(decodeInboxFragment(output.inboxFragment)).toEqual({
      secret: fromHex(input.inboxSecret),
      passwordSalt: null,
    });
    expect(decodeInboxFragment(output.inboxFragmentWithPassword)).toEqual({
      secret: fromHex(input.inboxSecret),
      passwordSalt: fromHex(input.passwordSalt),
    });
  });

  it("should open the frozen vault and unwrap the frozen file secret", async () => {
    const { inboxKey } = await deriveInboxKeys(fromHex(input.inboxSecret));
    const title = { ciphertext: fromHex(output.titleCiphertext), nonce: fromHex(input.titleNonce) };
    const key = await openRequestKey(
      fromHex(output.vault),
      fromHex(input.vaultNonce),
      inboxKey,
      title,
    );
    expect(toHex(key.publicKey)).toBe(input.publicKey);
    expect(toHex(key.linkSecret)).toBe(input.linkSecret);
    const wrapped = { enc: fromHex(output.wrapEnc), ciphertext: fromHex(output.wrapCiphertext) };
    expect(toHex(await unwrapFileSecret(key, input.requestId, input.uploadId, wrapped))).toBe(
      input.fileSecret,
    );
  });

  it("should decrypt the frozen title", async () => {
    const { titleKey } = await deriveLinkKeys(fromHex(input.linkSecret), publicKey);
    const title = { ciphertext: fromHex(output.titleCiphertext), nonce: fromHex(input.titleNonce) };
    expect(await decryptRequestTitle(title, titleKey)).toBe(input.title);
  });
});

describe("createFileRequest", () => {
  it("should create a request whose vault opens with the inbox secret", async () => {
    const { request, key } = await freshRequest();
    expect(request.local.inboxSecret.length).toBe(32);
    expect(request.local.linkSecret.length).toBe(32);
    expect(request.local.publicKey.length).toBe(65);
    expect(request.server.vault.length).toBe(REQUEST_VAULT_LENGTH);
    expect(key.publicKey).toEqual(request.local.publicKey);
    expect(key.linkSecret).toEqual(request.local.linkSecret);
    expect(request.server.title).toBeNull();
  });

  it("should hand the server only the vault, the tokens and the title", async () => {
    const { request } = await freshRequest("Tax documents");
    expect(Object.keys(request.server).sort()).toEqual(
      ["inboxAuthToken", "inboxOwnerToken", "title", "uploadToken", "vault", "vaultNonce"].sort(),
    );
    const sent = JSON.stringify(request.server, (_key, value: unknown) =>
      value instanceof Uint8Array ? toHex(value) : value,
    );
    for (const secret of [
      request.local.inboxSecret,
      request.local.linkSecret,
      request.local.publicKey,
    ]) {
      expect(sent).not.toContain(toHex(secret));
    }
  });

  it("should hand out the tokens the server checks", async () => {
    const { request } = await freshRequest();
    const inbox = await deriveInboxKeys(request.local.inboxSecret);
    const link = await deriveLinkKeys(request.local.linkSecret, request.local.publicKey);
    expect(request.server.inboxAuthToken).toEqual(inbox.inboxAuthToken);
    expect(request.server.inboxOwnerToken).toEqual(inbox.inboxOwnerToken);
    expect(request.server.uploadToken).toEqual(link.uploadToken);
  });

  it("should encrypt the title for the upload link", async () => {
    const { request, key } = await freshRequest("Unterlagen 2026");
    const { titleKey } = await deriveLinkKeys(key.linkSecret, key.publicKey);
    expect(await decryptRequestTitle(request.server.title!, titleKey)).toBe("Unterlagen 2026");
  });

  it("should never hand out an exportable key", async () => {
    const { key } = await freshRequest();
    expect(key.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("jwk", key.privateKey)).rejects.toThrow();
    const { inboxKey } = await deriveInboxKeys(randomBytes(32));
    const { titleKey } = await deriveLinkKeys(randomBytes(32), key.publicKey);
    expect(inboxKey.extractable).toBe(false);
    expect(titleKey.extractable).toBe(false);
  });

  it("should make every request different", async () => {
    const a = (await freshRequest()).request;
    const b = (await freshRequest()).request;
    expect(toHex(a.local.publicKey)).not.toBe(toHex(b.local.publicKey));
    expect(toHex(a.local.inboxSecret)).not.toBe(toHex(b.local.inboxSecret));
    expect(toHex(a.server.vaultNonce)).not.toBe(toHex(b.server.vaultNonce));
  });
});

describe("openRequestKey", () => {
  it("should reject the wrong inbox secret", async () => {
    const { request } = await freshRequest();
    const { inboxKey } = await deriveInboxKeys(randomBytes(32));
    await expect(
      openRequestKey(request.server.vault, request.server.vaultNonce, inboxKey, null),
    ).rejects.toThrow();
  });

  it("should reject a title the server swapped, added or dropped", async () => {
    const { request } = await freshRequest("Tax documents");
    const other = await createFileRequest({ title: "Upload your ID here" });
    const { vault, vaultNonce, title } = request.server;
    const { inboxKey } = await deriveInboxKeys(request.local.inboxSecret);
    await expect(openRequestKey(vault, vaultNonce, inboxKey, title)).resolves.toBeTruthy();
    await expect(openRequestKey(vault, vaultNonce, inboxKey, null)).rejects.toThrow();
    await expect(openRequestKey(vault, vaultNonce, inboxKey, other.server.title)).rejects.toThrow();
    const flippedTitle = { ciphertext: flipped(title!.ciphertext), nonce: title!.nonce };
    await expect(openRequestKey(vault, vaultNonce, inboxKey, flippedTitle)).rejects.toThrow();

    const untitled = await freshRequest();
    const untitledKey = (await deriveInboxKeys(untitled.request.local.inboxSecret)).inboxKey;
    await expect(
      openRequestKey(
        untitled.request.server.vault,
        untitled.request.server.vaultNonce,
        untitledKey,
        title,
      ),
    ).rejects.toThrow();
  });

  it("should reject a changed vault or nonce, or one of the wrong length", async () => {
    const { request } = await freshRequest();
    const { vault, vaultNonce } = request.server;
    const { inboxKey } = await deriveInboxKeys(request.local.inboxSecret);
    await expect(openRequestKey(flipped(vault), vaultNonce, inboxKey, null)).rejects.toThrow();
    await expect(
      openRequestKey(flipped(vault, vault.length - 1), vaultNonce, inboxKey, null),
    ).rejects.toThrow();
    await expect(openRequestKey(vault, flipped(vaultNonce), inboxKey, null)).rejects.toThrow();
    await expect(openRequestKey(vault, vaultNonce.slice(0, 11), inboxKey, null)).rejects.toThrow(
      "Vault nonce must be exactly 12 bytes",
    );
    await expect(openRequestKey(vault.slice(1), vaultNonce, inboxKey, null)).rejects.toThrow(
      "Vault must be exactly 146 bytes",
    );
  });

  it("should reject a vault of another suite or with a broken key", async () => {
    const inboxSecret = randomBytes(32);
    const { inboxKey } = await deriveInboxKeys(inboxSecret);
    const { request } = await freshRequest();
    const seal = async (plaintext: Uint8Array) => {
      const nonce = randomBytes(12);
      const additionalData = new TextEncoder().encode("skysend-inbox-privkey-v1");
      const sealed = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData },
        inboxKey,
        plaintext,
      );
      return openRequestKey(new Uint8Array(sealed), nonce, inboxKey, null);
    };
    const body = [...request.local.publicKey, ...request.local.linkSecret, ...randomBytes(32)];
    await expect(seal(new Uint8Array([0x02, ...body]))).rejects.toThrow(
      "Unsupported request vault",
    );
    const brokenPoint = new Uint8Array([REQUEST_SUITE, 0x05, ...body.slice(1)]);
    await expect(seal(brokenPoint)).rejects.toThrow("uncompressed P-256 point");
    // A scalar that does not belong to the public key.
    const wrongScalar = new Uint8Array([REQUEST_SUITE, ...body]);
    await expect(seal(wrongScalar)).rejects.toThrow();
  });
});

describe("wrapFileSecret and unwrapFileSecret", () => {
  it("should round-trip a file secret", async () => {
    const { request, key } = await freshRequest();
    const fileSecret = generateSecret();
    const wrapped = await wrapFileSecret(request.local.publicKey, requestId, uploadId, fileSecret);
    expect(wrapped.enc.length).toBe(WRAP_ENC_LENGTH);
    expect(wrapped.ciphertext.length).toBe(WRAP_CIPHERTEXT_LENGTH);
    expect(await unwrapFileSecret(key, requestId, uploadId, wrapped)).toEqual(fileSecret);
  });

  it("should bind the wrap to its request and upload", async () => {
    const { request, key } = await freshRequest();
    const wrapped = await wrapFileSecret(
      request.local.publicKey,
      requestId,
      uploadId,
      generateSecret(),
    );
    await expect(unwrapFileSecret(key, crypto.randomUUID(), uploadId, wrapped)).rejects.toThrow();
    await expect(unwrapFileSecret(key, requestId, crypto.randomUUID(), wrapped)).rejects.toThrow();
    // The same IDs in upper case are the same 16 bytes and still open.
    await expect(
      unwrapFileSecret(key, requestId.toUpperCase(), uploadId.toUpperCase(), wrapped),
    ).resolves.toHaveLength(32);
  });

  it("should not open with the key of another request", async () => {
    const { request } = await freshRequest();
    const other = await freshRequest();
    const wrapped = await wrapFileSecret(
      request.local.publicKey,
      requestId,
      uploadId,
      generateSecret(),
    );
    await expect(unwrapFileSecret(other.key, requestId, uploadId, wrapped)).rejects.toThrow();
  });

  it("should reject a changed or negated enc and a changed ciphertext", async () => {
    const { request, key } = await freshRequest();
    const wrapped = await wrapFileSecret(
      request.local.publicKey,
      requestId,
      uploadId,
      generateSecret(),
    );
    const variants: WrappedFileSecret[] = [
      { enc: negate(wrapped.enc), ciphertext: wrapped.ciphertext },
      { enc: flipped(wrapped.enc, 64), ciphertext: wrapped.ciphertext },
      { enc: wrapped.enc, ciphertext: flipped(wrapped.ciphertext) },
      { enc: wrapped.enc, ciphertext: flipped(wrapped.ciphertext, 47) },
    ];
    for (const variant of variants) {
      await expect(unwrapFileSecret(key, requestId, uploadId, variant)).rejects.toThrow();
    }
  });

  it("should check the lengths and the inputs", async () => {
    const { request, key } = await freshRequest();
    const pk = request.local.publicKey;
    const wrapped = await wrapFileSecret(pk, requestId, uploadId, generateSecret());
    const shortEnc = { enc: wrapped.enc.slice(1), ciphertext: wrapped.ciphertext };
    const shortCiphertext = { enc: wrapped.enc, ciphertext: wrapped.ciphertext.slice(1) };
    await expect(unwrapFileSecret(key, requestId, uploadId, shortEnc)).rejects.toThrow(
      "exactly 65 bytes",
    );
    await expect(unwrapFileSecret(key, requestId, uploadId, shortCiphertext)).rejects.toThrow(
      "exactly 48 bytes",
    );
    await expect(wrapFileSecret(pk, requestId, uploadId, randomBytes(16))).rejects.toThrow(
      "File secret must be exactly 32 bytes",
    );
    await expect(wrapFileSecret(pk, "not-a-uuid", uploadId, generateSecret())).rejects.toThrow(
      "ID must be a UUID",
    );
    await expect(wrapFileSecret(pk, requestId, `${uploadId}0`, generateSecret())).rejects.toThrow(
      "ID must be a UUID",
    );
  });
});

describe("request key derivation", () => {
  it("should be deterministic", async () => {
    const secret = randomBytes(32);
    const { publicKey } = (await createFileRequest()).local;
    const a = await deriveInboxKeys(secret);
    const b = await deriveInboxKeys(secret);
    expect(a.inboxAuthToken).toEqual(b.inboxAuthToken);
    expect(a.inboxOwnerToken).toEqual(b.inboxOwnerToken);
    expect((await deriveLinkKeys(secret, publicKey)).uploadToken).toEqual(
      (await deriveLinkKeys(secret, publicKey)).uploadToken,
    );
  });

  it("should keep every token apart, also from the tokens of a file with the same secret", async () => {
    const secret = randomBytes(32);
    const salt = randomBytes(32);
    const { publicKey } = (await createFileRequest()).local;
    const inbox = await deriveInboxKeys(secret);
    const link = await deriveLinkKeys(secret, publicKey);
    const fileKeys = await deriveKeys(secret, salt);
    const tokens = [
      inbox.inboxAuthToken,
      inbox.inboxOwnerToken,
      link.uploadToken,
      await computeAuthToken(fileKeys.authKey),
      await computeOwnerToken(secret, salt),
    ].map(toHex);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("should keep the AES keys apart, also from the keys of a file with the same secret", async () => {
    const secret = randomBytes(32);
    const { publicKey } = (await createFileRequest()).local;
    const { inboxKey } = await deriveInboxKeys(secret);
    const { titleKey } = await deriveLinkKeys(secret, publicKey);
    const { metaKey } = await deriveKeys(secret, randomBytes(32));
    const title = await encryptRequestTitle("hello", titleKey);
    await expect(decryptRequestTitle(title, inboxKey)).rejects.toThrow();
    const metadata = await encryptMetadata(
      { type: "single", name: "a", size: 1, mimeType: "text/plain" },
      metaKey,
    );
    await expect(decryptMetadata(metadata.ciphertext, metadata.iv, titleKey)).rejects.toThrow();
  });

  it("should bind the upload token and the title key to the public key", async () => {
    const linkSecret = randomBytes(32);
    const a = (await createFileRequest()).local.publicKey;
    const b = (await createFileRequest()).local.publicKey;
    const keysA = await deriveLinkKeys(linkSecret, a);
    const keysB = await deriveLinkKeys(linkSecret, b);
    expect(toHex(keysA.uploadToken)).not.toBe(toHex(keysB.uploadToken));
    const title = await encryptRequestTitle("hello", keysA.titleKey);
    await expect(decryptRequestTitle(title, keysB.titleKey)).rejects.toThrow();
  });

  it("should reject secrets and keys of the wrong form", async () => {
    const { publicKey } = (await createFileRequest()).local;
    await expect(deriveInboxKeys(randomBytes(31))).rejects.toThrow(
      "Inbox secret must be exactly 32 bytes",
    );
    await expect(deriveLinkKeys(randomBytes(33), publicKey)).rejects.toThrow(
      "Link secret must be exactly 32 bytes",
    );
    await expect(deriveLinkKeys(randomBytes(32), publicKey.slice(1))).rejects.toThrow(
      "uncompressed P-256 point",
    );
  });
});

describe("request titles", () => {
  it("should round-trip a title, also an empty one and one at the limit", async () => {
    const { publicKey } = (await createFileRequest()).local;
    const { titleKey } = await deriveLinkKeys(randomBytes(32), publicKey);
    for (const title of ["Steuerunterlagen 2026 ✓", "", "a".repeat(REQUEST_TITLE_MAX_BYTES)]) {
      expect(await decryptRequestTitle(await encryptRequestTitle(title, titleKey), titleKey)).toBe(
        title,
      );
    }
  });

  it("should reject a title over the limit, a changed title, a wrong key or nonce", async () => {
    const { publicKey } = (await createFileRequest()).local;
    const { titleKey } = await deriveLinkKeys(randomBytes(32), publicKey);
    const other = await deriveLinkKeys(randomBytes(32), publicKey);
    await expect(
      encryptRequestTitle("ä".repeat(REQUEST_TITLE_MAX_BYTES / 2 + 1), titleKey),
    ).rejects.toThrow(`Title must be at most ${REQUEST_TITLE_MAX_BYTES} bytes`);
    const title = await encryptRequestTitle("Hello", titleKey);
    await expect(
      decryptRequestTitle({ ...title, ciphertext: flipped(title.ciphertext) }, titleKey),
    ).rejects.toThrow();
    await expect(decryptRequestTitle(title, other.titleKey)).rejects.toThrow();
    await expect(
      decryptRequestTitle({ ...title, nonce: title.nonce.slice(1) }, titleKey),
    ).rejects.toThrow("Title nonce must be exactly 12 bytes");
    const tooLong = { ciphertext: randomBytes(REQUEST_TITLE_MAX_BYTES + 17), nonce: title.nonce };
    await expect(decryptRequestTitle(tooLong, titleKey)).rejects.toThrow("Title is too long");
  });
});

describe("upload fragments", () => {
  it("should round-trip the public key and the link secret", async () => {
    const { local } = await createFileRequest();
    const fragment = encodeUploadFragment(local.publicKey, local.linkSecret);
    expect(fragment).toHaveLength(131);
    const decoded = await decodeUploadFragment(fragment);
    expect(decoded.publicKey).toEqual(local.publicKey);
    expect(decoded.linkSecret).toEqual(local.linkSecret);
  });

  it("should reject anything but the exact format", async () => {
    const { local } = await createFileRequest();
    const bytes = new Uint8Array([REQUEST_SUITE, ...local.publicKey, ...local.linkSecret]);
    const offCurve = new Uint8Array(bytes);
    offCurve[65]! ^= 0x01;
    const invalid = [
      toBase64url(bytes.slice(1)),
      toBase64url(flipped(bytes, 0)),
      toBase64url(flipped(bytes, 1)),
      toBase64url(offCurve),
      toBase64url(new Uint8Array([...bytes, 0])),
      `${toBase64url(bytes)}==`,
      "not base64url!",
    ];
    for (const fragment of invalid) {
      await expect(decodeUploadFragment(fragment)).rejects.toThrow("Not a valid upload link");
    }
    expect(() => encodeUploadFragment(local.publicKey.slice(1), local.linkSecret)).toThrow(
      "uncompressed P-256 point",
    );
    expect(() => encodeUploadFragment(local.publicKey, local.linkSecret.slice(1))).toThrow(
      "Link secret must be exactly 32 bytes",
    );
  });

  it("should reject a non-canonical spelling of the same bytes", async () => {
    const { local } = await createFileRequest();
    const fragment = encodeUploadFragment(local.publicKey, local.linkSecret);
    // 98 bytes end in a 2-byte group, whose last character carries 2 unused bits.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(fragment.at(-1)!);
    const alias = fragment.slice(0, -1) + alphabet[last ^ 0x01];
    await expect(decodeUploadFragment(alias)).rejects.toThrow("Not a valid upload link");
  });
});

describe("inbox fragments", () => {
  it("should round-trip with and without a password salt", () => {
    const secret = randomBytes(32);
    const salt = randomBytes(16);
    expect(decodeInboxFragment(encodeInboxFragment(secret))).toEqual({
      secret,
      passwordSalt: null,
    });
    expect(decodeInboxFragment(encodeInboxFragment(secret, salt))).toEqual({
      secret,
      passwordSalt: salt,
    });
  });

  it("should let a password protect the inbox the way it protects a file", async () => {
    const { local } = await createFileRequest();
    const passwordKey = randomBytes(32);
    const salt = randomBytes(16);
    const fragment = encodeInboxFragment(
      applyPasswordProtection(local.inboxSecret, passwordKey),
      salt,
    );
    const decoded = decodeInboxFragment(fragment);
    expect(decoded.passwordSalt).toEqual(salt);
    expect(decoded.secret).not.toEqual(local.inboxSecret);
    expect(applyPasswordProtection(decoded.secret, passwordKey)).toEqual(local.inboxSecret);
  });

  it("should reject anything but the exact format", () => {
    const secret = randomBytes(32);
    const invalid = [
      toBase64url(new Uint8Array([0x02, ...secret])),
      toBase64url(new Uint8Array([0x01, ...secret.slice(1)])),
      toBase64url(new Uint8Array([0x01, ...secret, ...randomBytes(8)])),
      `${encodeInboxFragment(secret)}=`,
      "!",
    ];
    for (const fragment of invalid) {
      expect(() => decodeInboxFragment(fragment)).toThrow("Not a valid inbox link");
    }
    expect(() => encodeInboxFragment(secret.slice(1))).toThrow(
      "Inbox secret must be exactly 32 bytes",
    );
    expect(() => encodeInboxFragment(secret, randomBytes(8))).toThrow(
      "Password salt must be exactly 16 bytes",
    );
  });
});
