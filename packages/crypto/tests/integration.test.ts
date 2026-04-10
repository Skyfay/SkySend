import { describe, expect, it } from "vitest";
import {
  generateSecret,
  generateSalt,
  deriveKeys,
  computeAuthToken,
  computeOwnerToken,
  createEncryptStream,
  createDecryptStream,
  encryptMetadata,
  decryptMetadata,
  deriveKeyFromPassword,
  applyPasswordProtection,
  toBase64url,
  fromBase64url,
  constantTimeEqual,
  randomBytes,
  RECORD_SIZE,
  PASSWORD_SALT_LENGTH,
} from "../src/index.js";

/** Helper: collect all chunks from a ReadableStream. */
async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Helper: create a ReadableStream from a Uint8Array. */
function toStream(data: Uint8Array, chunkSize = RECORD_SIZE): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, data.length);
      controller.enqueue(data.slice(offset, end));
      offset = end;
    },
  });
}

describe("Integration: full upload/download roundtrip", () => {
  it("should encrypt and decrypt a file with metadata (no password)", async () => {
    // === Upload Phase (Client) ===

    // 1. Generate secret and salt
    const secret = generateSecret();
    const salt = generateSalt();

    // 2. Derive keys
    const { fileKey, metaKey, authKey } = await deriveKeys(secret, salt);

    // 3. Compute tokens
    const authToken = await computeAuthToken(authKey);
    const ownerToken = await computeOwnerToken(secret, salt);

    // 4. Encrypt file content (streaming)
    const originalContent = randomBytes(RECORD_SIZE * 2 + 12345);
    const encryptedFile = await collectStream(
      toStream(originalContent).pipeThrough(createEncryptStream(fileKey)),
    );

    // 5. Encrypt metadata
    const metadata = {
      type: "single" as const,
      name: "test-document.pdf",
      size: originalContent.length,
      mimeType: "application/pdf",
    };
    const encryptedMeta = await encryptMetadata(metadata, metaKey);

    // 6. Create share link fragment
    const shareFragment = toBase64url(secret);
    expect(shareFragment.length).toBeGreaterThan(0);

    // === Verify tokens are deterministic ===
    const authToken2 = await computeAuthToken(authKey);
    expect(constantTimeEqual(authToken, authToken2)).toBe(true);

    const ownerToken2 = await computeOwnerToken(secret, salt);
    expect(constantTimeEqual(ownerToken, ownerToken2)).toBe(true);

    // === Download Phase (Client) ===

    // 1. Recover secret from URL fragment
    const recoveredSecret = fromBase64url(shareFragment);
    expect(constantTimeEqual(recoveredSecret, secret)).toBe(true);

    // 2. Re-derive keys with the same salt
    const recoveredKeys = await deriveKeys(recoveredSecret, salt);

    // 3. Verify auth token matches
    const recoveredAuthToken = await computeAuthToken(recoveredKeys.authKey);
    expect(constantTimeEqual(recoveredAuthToken, authToken)).toBe(true);

    // 4. Decrypt metadata
    const decryptedMeta = await decryptMetadata(
      encryptedMeta.ciphertext,
      encryptedMeta.iv,
      recoveredKeys.metaKey,
    );
    expect(decryptedMeta).toEqual(metadata);

    // 5. Decrypt file content (streaming)
    const decryptedContent = await collectStream(
      toStream(encryptedFile, 8192).pipeThrough(createDecryptStream(recoveredKeys.fileKey)),
    );

    expect(decryptedContent.length).toBe(originalContent.length);
    expect(constantTimeEqual(decryptedContent, originalContent)).toBe(true);
  });

  it("should encrypt and decrypt a file with password protection", async () => {
    const password = "super-secret-password-123!";

    // === Upload Phase ===

    // 1. Generate secret, salt, password salt
    const secret = generateSecret();
    const salt = generateSalt();
    const passwordSalt = randomBytes(PASSWORD_SALT_LENGTH);

    // 2. Derive password key
    const { key: passwordKey, algorithm } = await deriveKeyFromPassword(password, passwordSalt);
    expect(algorithm).toBe("pbkdf2"); // No Argon2id WASM in tests

    // 3. Protect the secret with the password
    const protectedSecret = applyPasswordProtection(secret, passwordKey);

    // 4. Derive keys from the ORIGINAL secret (not protected)
    const { fileKey, metaKey } = await deriveKeys(secret, salt);

    // 5. Encrypt content and metadata
    const originalContent = new TextEncoder().encode("Password-protected file content!");
    const encryptedFile = await collectStream(
      toStream(originalContent).pipeThrough(createEncryptStream(fileKey)),
    );
    const encryptedMeta = await encryptMetadata(
      { type: "single", name: "secret.txt", size: originalContent.length, mimeType: "text/plain" },
      metaKey,
    );

    // 6. Share link contains the PROTECTED secret
    const shareFragment = toBase64url(protectedSecret);

    // === Download Phase ===

    // 1. Recover protected secret from URL
    const recoveredProtectedSecret = fromBase64url(shareFragment);

    // 2. User enters password, derive password key
    const { key: recoveredPasswordKey } = await deriveKeyFromPassword(password, passwordSalt);

    // 3. Recover original secret
    const recoveredSecret = applyPasswordProtection(recoveredProtectedSecret, recoveredPasswordKey);
    expect(constantTimeEqual(recoveredSecret, secret)).toBe(true);

    // 4. Derive keys and decrypt
    const recoveredKeys = await deriveKeys(recoveredSecret, salt);
    const decryptedMeta = await decryptMetadata(
      encryptedMeta.ciphertext,
      encryptedMeta.iv,
      recoveredKeys.metaKey,
    );
    expect(decryptedMeta.type).toBe("single");
    if (decryptedMeta.type === "single") {
      expect(decryptedMeta.name).toBe("secret.txt");
    }

    const decryptedContent = await collectStream(
      toStream(encryptedFile, 4096).pipeThrough(createDecryptStream(recoveredKeys.fileKey)),
    );
    expect(new TextDecoder().decode(decryptedContent)).toBe("Password-protected file content!");
  });

  it("should fail with wrong password", async () => {
    const secret = generateSecret();
    const salt = generateSalt();
    const passwordSalt = randomBytes(PASSWORD_SALT_LENGTH);

    // Encrypt with correct password
    const { key: passwordKey } = await deriveKeyFromPassword("correct-password", passwordSalt);
    const protectedSecret = applyPasswordProtection(secret, passwordKey);

    const { fileKey } = await deriveKeys(secret, salt);
    const originalContent = new TextEncoder().encode("secret");
    const encryptedFile = await collectStream(
      toStream(originalContent).pipeThrough(createEncryptStream(fileKey)),
    );

    // Try to decrypt with wrong password
    const { key: wrongPasswordKey } = await deriveKeyFromPassword("wrong-password", passwordSalt);
    const wrongSecret = applyPasswordProtection(protectedSecret, wrongPasswordKey);
    const wrongKeys = await deriveKeys(wrongSecret, salt);

    // Decryption should fail because the derived fileKey is wrong
    await expect(
      collectStream(
        toStream(encryptedFile, 4096).pipeThrough(createDecryptStream(wrongKeys.fileKey)),
      ),
    ).rejects.toThrow("corrupted or tampered");
  });

  it("should handle multi-file archive metadata", async () => {
    const secret = generateSecret();
    const salt = generateSalt();
    const { metaKey } = await deriveKeys(secret, salt);

    const metadata = {
      type: "archive" as const,
      files: [
        { name: "photo1.jpg", size: 500_000 },
        { name: "photo2.jpg", size: 600_000 },
        { name: "readme.txt", size: 256 },
      ],
      totalSize: 1_100_256,
    };

    const encrypted = await encryptMetadata(metadata, metaKey);
    const decrypted = await decryptMetadata(encrypted.ciphertext, encrypted.iv, metaKey);

    expect(decrypted).toEqual(metadata);
    if (decrypted.type === "archive") {
      expect(decrypted.files).toHaveLength(3);
      expect(decrypted.totalSize).toBe(1_100_256);
    }
  });
});
