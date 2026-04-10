# Cryptography Overview

The `@skysend/crypto` package (`packages/crypto`) is the shared encryption library used by both the server and the web frontend. It provides:

- Key generation and derivation (HKDF-SHA256)
- Streaming file encryption/decryption (AES-256-GCM)
- Metadata encryption/decryption (AES-256-GCM)
- Password-based key derivation (Argon2id / PBKDF2-SHA256)
- Utility functions (base64url, constant-time comparison)

## Design Principles

1. **Web Crypto API** - All crypto operations use the native Web Crypto API. No external crypto dependencies.
2. **Streaming** - File encryption uses the Web Streams API (`TransformStream`) for memory-efficient processing of large files.
3. **Domain Separation** - Each derived key uses a unique HKDF info string to prevent key reuse across contexts.
4. **No Custom Crypto** - Standard, well-analyzed algorithms only (AES-256-GCM, HKDF-SHA256, HMAC-SHA256).

## Public API

```typescript
// Key Generation
generateSecret(): Uint8Array            // 32 bytes
generateSalt(): Uint8Array              // 16 bytes
deriveKeys(secret, salt): Promise<Keys> // fileKey, metaKey, authKey
computeAuthToken(authKey): Promise<Uint8Array>
computeOwnerToken(secret, salt): Promise<Uint8Array>

// Streaming ECE
createEncryptStream(fileKey): TransformStream
createDecryptStream(fileKey): TransformStream
calculateEncryptedSize(plaintextSize): number
calculatePlaintextSize(encryptedSize): number

// Metadata
encryptMetadata(metadata, metaKey): Promise<{ ciphertext, iv }>
decryptMetadata(ciphertext, iv, metaKey): Promise<Metadata>

// Password
deriveKeyFromPassword(password, salt, argon2id?): Promise<{ key, algorithm }>
applyPasswordProtection(secret, passwordKey): Uint8Array

// Utilities
toBase64url(data): string
fromBase64url(str): Uint8Array
constantTimeEqual(a, b): boolean
randomBytes(length): Uint8Array
```

## Pages

- [Key Derivation](/developer-guide/crypto/key-derivation) - HKDF-SHA256 key generation and derivation
- [Streaming Encryption](/developer-guide/crypto/streaming-encryption) - AES-256-GCM ECE format
- [Metadata Encryption](/developer-guide/crypto/metadata-encryption) - File metadata encryption
- [Password Protection](/developer-guide/crypto/password-protection) - Argon2id and PBKDF2
