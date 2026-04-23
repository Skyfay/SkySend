# Key Derivation

SkySend derives all encryption keys from a single 256-bit secret using HKDF-SHA256.

## Secret Generation

A 32-byte secret is generated per upload using `crypto.getRandomValues()`:

```typescript
const secret = generateSecret() // 32 bytes (256 bits)
```

This secret is the root of all derived keys. It is embedded in the share link URL fragment and never sent to the server.

## Salt

A 32-byte random salt is generated per upload:

```typescript
const salt = generateSalt() // 32 bytes (per RFC 5869, equal to SHA-256 output length)
```

The salt is stored on the server (in the database) and included in the info response so that the downloader can derive the same keys. Legacy uploads created before v2.4.4 use a 16-byte salt, which `deriveKeys()` continues to accept for backward compatibility.

## Key Derivation with HKDF

Three keys are derived from the secret using HKDF-SHA256 with domain-separated info strings:

```typescript
const keys = await deriveKeys(secret, salt)
// keys.fileKey  - AES-256-GCM key for file encryption
// keys.metaKey  - AES-256-GCM key for metadata encryption
// keys.authKey  - HMAC-SHA256 key for auth token
```

### HKDF Info Strings

| Key | HKDF Info String | Usage |
| --- | --- | --- |
| `fileKey` | `"skysend-file-encryption"` | AES-256-GCM file encryption/decryption |
| `metaKey` | `"skysend-metadata"` | AES-256-GCM metadata encryption/decryption |
| `authKey` | `"skysend-authentication"` | HMAC-SHA256 auth token computation |

Each info string provides domain separation, ensuring that even with the same secret and salt, each derived key is cryptographically independent.

### Implementation

```typescript
// 1. Import secret as HKDF key
const baseKey = await crypto.subtle.importKey(
  'raw', secret, { name: 'HKDF' }, false, ['deriveKey']
)

// 2. Derive AES-256-GCM key
const fileKey = await crypto.subtle.deriveKey(
  { name: 'HKDF', hash: 'SHA-256', salt, info: encode('skysend-file-encryption') },
  baseKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
)
```

Keys are imported as **non-extractable** to prevent accidental leakage.

## Token Derivation

### Auth Token

The auth token proves knowledge of the secret (required for download):

```typescript
const authToken = await computeAuthToken(authKey)
// HMAC-SHA256(authKey, "skysend-auth-token")
```

### Owner Token

The owner token proves upload ownership (required for deletion/metadata):

```typescript
const ownerToken = await computeOwnerToken(secret, salt)
// HKDF-SHA256(secret, salt, "skysend-owner-token")
```

Both tokens are sent to the server during upload and verified using constant-time comparison.

## Constants

| Constant | Value |
| --- | --- |
| `SECRET_LENGTH` | 32 bytes |
| `SALT_LENGTH` | 32 bytes (16 bytes accepted for legacy uploads) |
