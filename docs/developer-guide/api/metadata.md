# Metadata & Info API

## GET /api/info/:id

Retrieve public information about an upload. No authentication required.

### Response

**200 OK:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "size": 1048576,
  "fileCount": 1,
  "hasPassword": false,
  "passwordAlgo": null,
  "passwordSalt": null,
  "salt": "<base64url encoded salt>",
  "encryptedMeta": "<base64 encoded ciphertext>",
  "nonce": "<base64 encoded IV>",
  "downloadCount": 3,
  "maxDownloads": 10,
  "expiresAt": "2025-01-02T00:00:00.000Z",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

For password-protected uploads, `passwordAlgo` and `passwordSalt` are included so the client can derive the password key.

**404 Not Found:**

```json
{
  "error": "Upload not found"
}
```

**410 Gone:**

```json
{
  "error": "Upload expired or download limit reached"
}
```

### Notes

- Sensitive fields (tokens, storage path) are excluded from the response
- The `encryptedMeta` and `nonce` fields are the encrypted file metadata (names, types, sizes)
- The `salt` is needed by the downloader to derive encryption keys from the secret

## GET /api/exists/:id

Lightweight existence check. No authentication required.

### Response

**200 OK** (upload exists and is available):

```json
{
  "exists": true
}
```

**404 Not Found:**

```json
{
  "exists": false
}
```

**410 Gone** (expired or limit reached):

```json
{
  "exists": false,
  "reason": "expired"
}
```

```json
{
  "exists": false,
  "reason": "limit_reached"
}
```

### Notes

- This is a lightweight check that only queries the necessary fields
- Useful for validating share links before loading the full download page
