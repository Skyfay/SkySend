# Encryption Design

This document describes SkySend's encryption architecture in detail. It is intended as public audit material.

## Overview

SkySend uses client-side end-to-end encryption. All cryptographic operations happen in the browser using the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API). The server never has access to plaintext data, file names, or encryption keys.

```
Browser (Client)                              Server
---------------------------------------       ------
1. Generate 256-bit Secret Key
2. Derive keys via HKDF-SHA256:
   - fileKey   (AES-256-GCM)
   - metaKey   (AES-256-GCM)
   - authKey   (HMAC-SHA256)
3. If multi-file: Zip via fflate
4. Chunked encryption (64KB records)
5. Encrypt metadata (names, sizes)
6. Optional: Password via Argon2id
7. Send encrypted blob + auth ---------> Stores ciphertext only
                                         Never sees the secret
8. Share link: https://host/#secret
   (Fragment never sent to server)
```

## Cryptographic Primitives

| Component | Algorithm |
| --- | --- |
| Secret Key | 256-bit random (`crypto.getRandomValues`) |
| Key Derivation | HKDF-SHA256 |
| File Encryption | AES-256-GCM (64KB record size) |
| Metadata Encryption | AES-256-GCM + random 12-byte IV |
| Nonce Handling | Counter-based XOR (32-bit big-endian) |
| Auth Token | HMAC-SHA256 |
| Password KDF (preferred) | Argon2id (19 MiB memory, 2 iterations, 1 parallelism) |
| Password KDF (fallback) | PBKDF2-SHA256 (600,000 iterations) |

## Key Derivation

A single 256-bit secret is generated per upload. Three domain-separated keys are derived using HKDF-SHA256:

```
Secret (32 bytes, crypto.getRandomValues)
  |
  +-- HKDF(secret, salt, "skysend-file-encryption")   --> fileKey  (AES-256-GCM)
  +-- HKDF(secret, salt, "skysend-metadata")           --> metaKey  (AES-256-GCM)
  +-- HKDF(secret, salt, "skysend-authentication")     --> authKey  (HMAC-SHA256)
```

- The **salt** (16 bytes) is randomly generated per upload and stored on the server
- The **info** strings provide domain separation, ensuring each derived key is independent
- The secret is imported as a non-extractable HKDF key via Web Crypto

### Token Derivation

Two tokens are derived for server-side authorization:

- **authToken** = HMAC-SHA256(authKey, "skysend-auth-token") - required for download
- **ownerToken** = HKDF(secret, salt, "skysend-owner-token") - required for deletion and metadata upload

Both tokens are sent to the server during upload. The server stores them for later verification using constant-time comparison.

## Streaming Encryption (ECE)

File content is encrypted using a custom Encrypted Content-Encoding scheme based on AES-256-GCM with streaming support.

### Record Format

```
[baseNonce (12 bytes)] [record_0] [record_1] ... [record_N]

Each record:
  Plaintext:  up to 65,536 bytes
  Ciphertext: plaintext + 16-byte GCM auth tag
  Nonce:      baseNonce XOR counter (big-endian 32-bit)
```

### Constants

| Constant | Value |
| --- | --- |
| `RECORD_SIZE` | 65,536 bytes (64 KB plaintext) |
| `TAG_LENGTH` | 16 bytes (GCM authentication tag) |
| `NONCE_LENGTH` | 12 bytes |
| `ENCRYPTED_RECORD_SIZE` | 65,552 bytes (plaintext + tag) |
| `MAX_RECORDS` | 2^32 - 1 |

### Nonce Construction

Each record uses a unique nonce derived from the base nonce:

```
nonce_i = baseNonce XOR i
```

Where `i` is the 0-based record index, XOR'd into the last 4 bytes of the nonce (big-endian). This guarantees unique nonces for up to 2^32 - 1 records (~256 TB of data).

### Security Properties

- **Unique nonce per record** - Counter-based XOR ensures no nonce reuse
- **Random base nonce** - Generated per encryption operation
- **Authenticated encryption** - GCM provides both confidentiality and integrity
- **Streaming** - Uses Web Streams API (`TransformStream`), memory-efficient for large files

## Metadata Encryption

File metadata (names, sizes, MIME types) is encrypted separately with AES-256-GCM:

- **Key**: `metaKey` (derived via HKDF, separate from `fileKey`)
- **IV**: 12-byte random (`META_IV_LENGTH = 12`)
- **Plaintext**: JSON-serialized metadata object

### Metadata Schema

For a single file:

```json
{
  "type": "single",
  "name": "document.pdf",
  "size": 1048576,
  "mimeType": "application/pdf"
}
```

For a multi-file archive:

```json
{
  "type": "archive",
  "files": [
    { "name": "photo1.jpg", "size": 524288 },
    { "name": "photo2.jpg", "size": 786432 }
  ],
  "totalSize": 1310720
}
```

The encrypted metadata and IV are stored in the database and returned via the info endpoint.

## Note Encryption

Note content is encrypted using the same AES-256-GCM algorithm as metadata, but with a dedicated key derivation path:

- **Key**: `metaKey` (derived via HKDF, same as metadata encryption)
- **IV**: 12-byte random per note
- **Plaintext**: The raw note content (text, password, code, Markdown, or SSH key data)

Unlike files, notes do not use streaming ECE because note content is limited in size (`NOTE_MAX_SIZE`, default 1 MB). The entire content is encrypted in a single AES-256-GCM operation.

### Content Types

The `contentType` field is stored unencrypted on the server so the client knows how to render the decrypted content. It does not reveal the actual note content. Supported values:

| contentType | Description |
| --- | --- |
| `text` | Plain text |
| `markdown` | Markdown (GitHub Flavored Markdown) |
| `password` | One or more passwords (separated by `\n\n`) |
| `code` | Code snippets |
| `sshkey` | SSH key pairs (public and/or private key) |

## Password Protection

When a user sets a password, additional protection is applied:

### Key Derivation

1. Generate a password salt (16 bytes)
2. Derive a `passwordKey` (32 bytes) from the password using Argon2id or PBKDF2-SHA256
3. XOR the secret with the password key: `protectedSecret = secret XOR passwordKey`
4. Store the password salt and algorithm on the server

### Argon2id Parameters

| Parameter | Value |
| --- | --- |
| Memory | 19,456 KiB (19 MiB) - OWASP minimum |
| Iterations | 2 |
| Parallelism | 1 |
| Hash Length | 32 bytes |

### PBKDF2 Fallback

If Argon2id WASM is unavailable (e.g., older browsers), PBKDF2-SHA256 is used:

- **Iterations**: 600,000 (OWASP 2024 recommendation)
- **Key Length**: 32 bytes

### Download Flow with Password

1. The downloader gets the password salt and algorithm from `GET /api/info/:id`
2. The user enters the password
3. The browser derives the `passwordKey` using the same KDF
4. The browser computes `secret = protectedSecret XOR passwordKey`
5. The browser derives keys from the recovered secret
6. The browser verifies the auth token via `POST /api/password/:id`
7. If valid, the download proceeds normally

## Security Invariants

1. **The secret never leaves the browser** - It is embedded in the URL fragment (`#`), which is not sent to servers per HTTP specification
2. **All encryption/decryption happens client-side** - Using the Web Crypto API
3. **Domain-separated key derivation** - Each key has a unique HKDF info string
4. **Constant-time token comparison** - Prevents timing attacks on auth/owner tokens
5. **No nonce reuse** - Counter-based XOR for ECE, random IV for metadata
6. **Authenticated encryption** - AES-256-GCM provides both confidentiality and integrity for every record
