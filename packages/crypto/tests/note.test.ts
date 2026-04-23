import { describe, expect, it } from "vitest";
import {
  encryptNoteContent,
  decryptNoteContent,
  NOTE_NONCE_LENGTH,
} from "../src/note.js";
import { deriveKeys, generateSecret, generateSalt } from "../src/keychain.js";

async function getMetaKey(): Promise<CryptoKey> {
  const keys = await deriveKeys(generateSecret(), generateSalt());
  return keys.metaKey;
}

describe("note encryption/decryption", () => {
  it("should round-trip plain text", async () => {
    const metaKey = await getMetaKey();
    const content = "Hello, this is a secret note!";

    const encrypted = await encryptNoteContent(content, metaKey);
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    expect(encrypted.nonce.length).toBe(NOTE_NONCE_LENGTH);

    const decrypted = await decryptNoteContent(encrypted.ciphertext, encrypted.nonce, metaKey);
    expect(decrypted).toBe(content);
  });

  it("should round-trip unicode content", async () => {
    const metaKey = await getMetaKey();
    const content = "Héllo Wörld! 日本語テスト 🔐🔑";

    const encrypted = await encryptNoteContent(content, metaKey);
    const decrypted = await decryptNoteContent(encrypted.ciphertext, encrypted.nonce, metaKey);
    expect(decrypted).toBe(content);
  });

  it("should round-trip empty string", async () => {
    const metaKey = await getMetaKey();
    const content = "";

    const encrypted = await encryptNoteContent(content, metaKey);
    const decrypted = await decryptNoteContent(encrypted.ciphertext, encrypted.nonce, metaKey);
    expect(decrypted).toBe(content);
  });

  it("should round-trip large content", async () => {
    const metaKey = await getMetaKey();
    const content = "x".repeat(1_000_000); // 1 MB of text

    const encrypted = await encryptNoteContent(content, metaKey);
    const decrypted = await decryptNoteContent(encrypted.ciphertext, encrypted.nonce, metaKey);
    expect(decrypted).toBe(content);
  });

  it("should produce different ciphertext for same content (unique nonce)", async () => {
    const metaKey = await getMetaKey();
    const content = "same content";

    const encrypted1 = await encryptNoteContent(content, metaKey);
    const encrypted2 = await encryptNoteContent(content, metaKey);

    // Nonces must differ
    expect(encrypted1.nonce).not.toEqual(encrypted2.nonce);
    // Ciphertext must differ due to different nonce
    expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
  });

  it("should fail decryption with wrong key", async () => {
    const keys1 = await deriveKeys(generateSecret(), generateSalt());
    const keys2 = await deriveKeys(generateSecret(), generateSalt());

    const encrypted = await encryptNoteContent("secret", keys1.metaKey);

    await expect(
      decryptNoteContent(encrypted.ciphertext, encrypted.nonce, keys2.metaKey),
    ).rejects.toThrow("Note decryption failed");
  });

  it("should fail decryption with tampered ciphertext", async () => {
    const metaKey = await getMetaKey();
    const encrypted = await encryptNoteContent("secret note", metaKey);

    // Flip a byte
    const tampered = new Uint8Array(encrypted.ciphertext);
    tampered[0] ^= 0xff;

    await expect(
      decryptNoteContent(tampered, encrypted.nonce, metaKey),
    ).rejects.toThrow("Note decryption failed");
  });

  it("should fail decryption with tampered nonce", async () => {
    const metaKey = await getMetaKey();
    const encrypted = await encryptNoteContent("secret note", metaKey);

    // Flip a bit in the nonce - AES-GCM authentication will fail
    const tamperedNonce = new Uint8Array(encrypted.nonce);
    tamperedNonce[0] ^= 0xff;

    await expect(
      decryptNoteContent(encrypted.ciphertext, tamperedNonce, metaKey),
    ).rejects.toThrow("Note decryption failed");
  });

  it("should reject invalid nonce length", async () => {
    const metaKey = await getMetaKey();
    const encrypted = await encryptNoteContent("test", metaKey);

    const badNonce = new Uint8Array(8); // wrong length

    await expect(
      decryptNoteContent(encrypted.ciphertext, badNonce, metaKey),
    ).rejects.toThrow(`Note nonce must be exactly ${NOTE_NONCE_LENGTH} bytes`);
  });

  it("should round-trip code content with special characters", async () => {
    const metaKey = await getMetaKey();
    const content = `function hello() {\n  console.log("Hello <world> & 'friends'");\n  return \`template \${literal}\`;\n}`;

    const encrypted = await encryptNoteContent(content, metaKey);
    const decrypted = await decryptNoteContent(encrypted.ciphertext, encrypted.nonce, metaKey);
    expect(decrypted).toBe(content);
  });
});
