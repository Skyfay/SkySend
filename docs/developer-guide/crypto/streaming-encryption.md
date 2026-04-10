# Streaming Encryption

SkySend uses a custom Encrypted Content-Encoding (ECE) scheme based on AES-256-GCM for streaming file encryption.

## Stream Format

```
[baseNonce (12 bytes)] [record_0] [record_1] ... [record_N]
```

The first 12 bytes of the encrypted stream are the randomly generated base nonce. The remaining bytes are encrypted records.

### Record Format

Each record consists of:

```
[ciphertext (up to 65,536 bytes)] [GCM auth tag (16 bytes)]
```

| Component | Size |
| --- | --- |
| Plaintext chunk | Up to 65,536 bytes (64 KB) |
| GCM auth tag | 16 bytes |
| Encrypted record | Up to 65,552 bytes |

The last record may be smaller than 65,536 bytes.

## Constants

| Constant | Value | Description |
| --- | --- | --- |
| `RECORD_SIZE` | 65,536 | Plaintext chunk size (64 KB) |
| `TAG_LENGTH` | 16 | GCM authentication tag size |
| `NONCE_LENGTH` | 12 | AES-GCM nonce size |
| `ENCRYPTED_RECORD_SIZE` | 65,552 | `RECORD_SIZE + TAG_LENGTH` |
| `MAX_RECORDS` | 2^32 - 1 | Maximum records per stream |

## Nonce Construction

Each record uses a unique nonce derived from the base nonce via XOR with a 32-bit counter:

```
nonce_i = baseNonce XOR counter_i
```

The counter is encoded as big-endian 32-bit integer, XOR'd into the last 4 bytes of the nonce:

```typescript
function nonceXorCounter(baseNonce: Uint8Array, counter: number): Uint8Array {
  const nonce = new Uint8Array(baseNonce)
  const view = new DataView(nonce.buffer)
  const offset = nonce.byteLength - 4  // last 4 bytes
  view.setUint32(offset, view.getUint32(offset) ^ counter)
  return nonce
}
```

This guarantees unique nonces for up to 2^32 - 1 records, which allows encrypting files up to approximately 256 TB.

## Encryption

```typescript
const encryptStream = createEncryptStream(fileKey)
const encryptedStream = plaintextStream.pipeThrough(encryptStream)
```

The `createEncryptStream` function returns a `TransformStream` that:

1. Outputs a 12-byte random base nonce as the first chunk
2. Buffers input into 64 KB plaintext chunks
3. Encrypts each chunk with AES-256-GCM using `nonce_i = baseNonce XOR i`
4. Outputs ciphertext + auth tag for each record
5. Flushes any remaining buffered data as the final (possibly smaller) record

## Decryption

```typescript
const decryptStream = createDecryptStream(fileKey)
const plaintextStream = encryptedStream.pipeThrough(decryptStream)
```

The `createDecryptStream` function returns a `TransformStream` that:

1. Reads the first 12 bytes as the base nonce
2. Buffers input into 65,552-byte encrypted records
3. Decrypts each record with AES-256-GCM, verifying the auth tag
4. Outputs plaintext chunks
5. Throws an error if any record fails authentication

## Size Calculation

```typescript
// Plaintext -> Encrypted size
const encryptedSize = calculateEncryptedSize(plaintextSize)
// Includes: 12-byte nonce header + (number of records * TAG_LENGTH)

// Encrypted -> Plaintext size
const plaintextSize = calculatePlaintextSize(encryptedSize)
```

## Security Properties

- **Confidentiality** - AES-256-GCM encryption
- **Integrity** - GCM auth tags on every record (16 bytes each)
- **No nonce reuse** - Counter-based XOR guarantees unique nonces
- **Random base nonce** - New random nonce per encryption operation
- **Streaming** - Constant memory usage regardless of file size
- **Record-level authentication** - Tampering with any individual record is detected immediately
