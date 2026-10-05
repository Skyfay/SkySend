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
}
```

`totalSize` is what the recipient sees, `archiveSize` is what the download is checked against. The two differ because the zip compresses its entries and adds its own headers. The uploader only knows `archiveSize` after packing, so the metadata is encrypted after the upload. Archives uploaded by older clients have no `archiveSize`.

`expectedPlaintextSize(metadata)` returns the size the decrypted file stream must have: `size` for a single file, `archiveSize` for an archive. See [Streaming Encryption](./streaming-encryption.md#decryption) for why every download checks it.

## Encryption

```typescript
const { ciphertext, iv } = await encryptMetadata(metadata, metaKey)
```

1. The metadata object is JSON-serialized
2. A random 12-byte IV is generated
3. The JSON is encrypted with AES-256-GCM using `metaKey` and the IV
4. Both `ciphertext` and `iv` are stored in the database (via `POST /api/meta/:id`)

## Decryption

```typescript
const metadata = await decryptMetadata(ciphertext, iv, metaKey)
```

1. The ciphertext is decrypted with AES-256-GCM
2. The result is parsed as JSON
3. The schema is validated (must be `SingleFileMetadata` or `ArchiveMetadata`)
4. Returns the typed metadata object

If decryption fails (wrong key, tampered data), an error is thrown.

## Constants

| Constant | Value |
| --- | --- |
| `META_IV_LENGTH` | 12 bytes |

## Security Properties

- **Domain-separated key** - `metaKey` is derived independently from `fileKey`
- **Random IV** - New IV per metadata encryption (no reuse)
- **Authenticated encryption** - GCM provides integrity verification
- **Schema validation** - Decrypted data is validated against expected schema
