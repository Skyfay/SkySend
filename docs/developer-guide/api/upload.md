# Upload API

## POST /api/upload

Upload an encrypted file stream to the server.

### Request

The request body is the raw encrypted stream (binary). All metadata is passed via headers.

#### Required Headers

| Header | Type | Description |
| --- | --- | --- |
| `X-Auth-Token` | base64url | Authentication token (HMAC-derived) |
| `X-Owner-Token` | base64url | Ownership token (HKDF-derived) |
| `X-Salt` | base64url | HKDF salt (must decode to exactly 16 bytes) |
| `X-Max-Downloads` | integer | Maximum number of downloads (must be a valid option) |
| `X-Expire-Sec` | integer | Expiry time in seconds (must be a valid option) |
| `X-File-Count` | integer | Number of files in the upload (1 for single, >1 for archive) |
| `X-Has-Password` | `"true"` / `"false"` | Whether the upload is password-protected |
| `Content-Length` | integer | Exact size of the encrypted payload in bytes |

#### Password Headers (required if `X-Has-Password: true`)

| Header | Type | Description |
| --- | --- | --- |
| `X-Password-Salt` | base64url | Password KDF salt (16 bytes) |
| `X-Password-Algo` | string | KDF algorithm: `"argon2id"` or `"pbkdf2"` |

### Validation

- `X-Salt` must decode to exactly 16 bytes
- `Content-Length` must not exceed `MAX_FILE_SIZE`
- `X-File-Count` must not exceed `MAX_FILES_PER_UPLOAD`
- `X-Expire-Sec` must be one of the configured `EXPIRE_OPTIONS_SEC`
- `X-Max-Downloads` must be one of the configured `DOWNLOAD_OPTIONS`
- Body size must match `Content-Length` exactly

### Response

**200 OK:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "url": "http://localhost:3000/file/a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**413 Payload Too Large:**

```json
{
  "error": "File size exceeds maximum allowed size"
}
```

### Example

```bash
curl -X POST http://localhost:3000/api/upload \
  -H "X-Auth-Token: dGVzdA" \
  -H "X-Owner-Token: dGVzdA" \
  -H "X-Salt: AAAAAAAAAAAAAAAAAAAAAA" \
  -H "X-Max-Downloads: 10" \
  -H "X-Expire-Sec: 86400" \
  -H "X-File-Count: 1" \
  -H "X-Has-Password: false" \
  -H "Content-Length: 65568" \
  --data-binary @encrypted-file.bin
```

## POST /api/meta/:id

Save encrypted metadata (file names, types, sizes) for an upload.

### Request

**Headers:**

| Header | Type | Description |
| --- | --- | --- |
| `X-Owner-Token` | base64url | Ownership token |

**Body:**

```json
{
  "encryptedMeta": "<base64 encoded ciphertext>",
  "nonce": "<base64 encoded IV>"
}
```

Both fields must be non-empty base64 strings.

### Response

**200 OK:**

```json
{
  "ok": true
}
```

**409 Conflict** (metadata already set):

```json
{
  "error": "Metadata already set"
}
```

### Notes

- Metadata can only be set once per upload (prevents overwriting)
- The upload must exist and the owner token must match
- Metadata is encrypted client-side with the `metaKey` derived from the secret
