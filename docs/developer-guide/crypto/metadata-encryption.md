# Metadata Encryption

File metadata (names, sizes, MIME types) is encrypted separately from the file content using AES-256-GCM.

## Why Separate Encryption?

Metadata is encrypted with a different key (`metaKey`) than the file content (`fileKey`). This allows the client to decrypt metadata before starting the file download, enabling the UI to display file names and sizes.

## Metadata Schema

### Single File

```typescript
interface SingleFileMetadata {
  type: "single"
  name: string         // e.g. "document.pdf"
  size: number         // original file size in bytes
  mimeType: string     // e.g. "application/pdf"
  streamNonce?: string // base nonce of the file stream, base64url
}
```

### Multi-File Archive

```typescript
interface ArchiveMetadata {
  type: "archive"
  files: Array<{
    name: string       // e.g. "photos/image1.jpg"
    size: number       // individual file size in bytes
  }>
  totalSize: number    // sum of all file sizes
  archiveSize?: number // size of the zip archive, the plaintext of the file stream
  streamNonce?: string // base nonce of the file stream, base64url
}
```

`totalSize` is what the recipient sees, `archiveSize` is what the download is checked against. The two differ by the headers of the zip. The browser stores every entry without compression and writes the zip while the upload reads it, so it knows `archiveSize` before the first byte. The CLI still compresses and learns it after packing. Either way the metadata goes to the server after the upload, and archives uploaded by older clients have no `archiveSize`.

The server takes at most `MAX_ENCRYPTED_METADATA_BYTES` (75,000 bytes, 100,000 characters of base64) of encrypted metadata. The names of all files of an archive travel in it, so the browser checks `encryptedMetadataLength` against that limit before an upload starts, instead of failing once every byte is up.

`expectedPlaintextSize(metadata)` returns the size the decrypted file stream must have: `size` for a single file, `archiveSize` for an archive. See [Streaming Encryption](./streaming-encryption.md#decryption) for why every download checks it.

`streamNonce` is the 12-byte base nonce that opens the file stream, which the header of the stream carries without authentication. `expectedBaseNonce(metadata)` returns it for `createDecryptStream`, which fails on a header that differs. Metadata whose `streamNonce` is not 12 bytes of canonical base64url is invalid. Uploads of older clients have none.

## Encryption

```typescript
const { ciphertext, iv } = await encryptMetadata(metadata, metaKey)
```

1. The metadata object is JSON-serialized
2. The JSON is padded with spaces to a multiple of 1024 bytes, so the length of the ciphertext tells little about the file names and types
3. A random 12-byte IV is generated
4. The padded JSON is encrypted with AES-256-GCM using `metaKey` and the IV
5. Both `ciphertext` and `iv` are stored in the database (via `POST /api/meta/:id`)

## Decryption

```typescript
const metadata = await decryptMetadata(ciphertext, iv, metaKey)
```

1. The ciphertext is decrypted with AES-256-GCM
2. The result is parsed as JSON, which ignores the trailing spaces, so padded and older unpadded metadata read alike
3. The schema is validated (must be `SingleFileMetadata` or `ArchiveMetadata`)
4. Returns the typed metadata object

If decryption fails (wrong key, tampered data), an error is thrown.

## Constants

| Constant | Value |
| --- | --- |
| `META_IV_LENGTH` | 12 bytes |
| `METADATA_PAD_BLOCK` | 1024 bytes |

## Security Properties

- **Domain-separated key** - `metaKey` is derived independently from `fileKey`
- **Random IV** - New IV per metadata encryption (no reuse)
- **Authenticated encryption** - GCM provides integrity verification
- **Schema validation** - Decrypted data is validated against expected schema
- **Padded length** - The ciphertext reveals the metadata length in whole kilobytes only
