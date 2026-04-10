# Download API

## GET /api/download/:id

Download the encrypted file stream.

### Request

**Headers:**

| Header | Type | Description |
| --- | --- | --- |
| `X-Auth-Token` | base64url | Authentication token |

### Response

**200 OK:**

The response body is the raw encrypted stream (`application/octet-stream`).

Response headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/octet-stream` |
| `Content-Length` | Size in bytes |
| `Cache-Control` | `no-store` |
| `X-File-Count` | Number of files in the upload |

**401 Unauthorized:**

```json
{
  "error": "Invalid or missing auth token"
}
```

**410 Gone:**

```json
{
  "error": "Upload expired or download limit reached"
}
```

### Notes

- Each successful download atomically increments the download counter
- If the download limit is reached during the increment, the request fails with `410`
- The file is streamed directly from disk - no buffering in memory
- `Cache-Control: no-store` prevents caching of encrypted content
- The `X-File-Count` header tells the client whether the payload is a single file or archive

### Example

```bash
curl -o encrypted.bin \
  -H "X-Auth-Token: dGVzdA" \
  http://localhost:3000/api/download/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```
