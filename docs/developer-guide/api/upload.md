# Upload API

## POST /api/upload

Upload an encrypted file stream to the server.

When `OIDC_PROTECT_FILES` is on, the request needs the session cookie or a bearer token, like the chunked init and the WebSocket. With an upload quota, the upload reserves `Content-Length` bytes when it starts and gives them back if it fails.

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
| `X-Password-Algo` | string | KDF algorithm: `"argon2id-v2"` |

### Validation

- `X-Salt` must decode to 16 or 32 bytes
- `Content-Length` must not exceed `FILE_MAX_SIZE`
- `X-File-Count` must not exceed `FILE_MAX_FILES_PER_UPLOAD`
- `X-Expire-Sec` must be one of the configured `FILE_EXPIRE_OPTIONS_SEC`
- `X-Max-Downloads` must be one of the configured `FILE_DOWNLOAD_OPTIONS`
- Body size must match `Content-Length` exactly. A body that grows past it is stopped, and nothing of it is stored

### Response

**201 Created:**

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

| Status | Error | Cause |
| --- | --- | --- |
| `401` | `Authentication required` | `OIDC_PROTECT_FILES` is on and the request carries no valid session |
| `413` | `Body size does not match declared content length` | The body grew past `Content-Length` |
| `413` | `File size exceeds remaining quota.` | `Content-Length` does not fit into what is left of the upload quota |
| `429` | `Upload quota exceeded. Try again later.` | The upload quota is used up |

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

## Chunked Upload

For large files, the web client uses a three-step chunked upload flow. Chunks are uploaded in parallel (up to 3 concurrent, 10 MB each) for optimal throughput through HTTP/2 reverse proxies.

### POST /api/upload/init

Initialize a chunked upload session. Validates headers and creates an empty storage entry.

With an upload quota, the init reserves `X-Content-Length` bytes until finalize, or until the session ends without one. A session that receives less than 1 MiB, or the rest of its upload, in 10 minutes is ended, the same rule the WebSocket applies.

#### Request

The request body is empty. All metadata is passed via headers (same headers as `POST /api/upload`).

#### Required Headers

| Header | Type | Description |
| --- | --- | --- |
| `X-Auth-Token` | base64url | Authentication token (HMAC-derived) |
| `X-Owner-Token` | base64url | Ownership token (HKDF-derived) |
| `X-Salt` | base64url | HKDF salt (must decode to 16 or 32 bytes) |
| `X-Max-Downloads` | integer | Maximum number of downloads (must be a valid option) |
| `X-Expire-Sec` | integer | Expiry time in seconds (must be a valid option) |
| `X-File-Count` | integer | Number of files in the upload (1 for single, >1 for archive) |
| `X-Has-Password` | `"true"` / `"false"` | Whether the upload is password-protected |
| `X-Content-Length` | integer | Exact size of the full encrypted payload in bytes |

#### Response

**201 Created:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

### POST /api/upload/:id/chunk

Append a chunk of encrypted data to a pending upload. Chunks may arrive out-of-order (parallel uploads). The server streams every chunk into a file under `DATA_DIR/tmp/chunks/` and appends the files to the storage backend in index order, so chunk data never stays in memory.

#### Query Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `index` | integer | Zero-based chunk index (required, must be >= 0) |

#### Request

The request body is the raw chunk bytes (binary). No additional headers are required.

Limits per chunk and per session:

- A chunk is at most 16 MiB. The server checks `Content-Length` first and stops reading a body without one once it passes the limit.
- All chunks of a session together never exceed the `X-Content-Length` declared at `/init`.
- A session accepts at most `FILE_UPLOAD_CONCURRENT_CHUNKS` chunk requests at the same time.
- Each chunk index is accepted once.
- An empty chunk is refused.
- At most 64 chunks wait for an earlier one. The chunk everything waits for is always taken.

The bundled clients send 10 MiB chunks and never more parallel requests than `fileUploadConcurrentChunks` from `/api/config`, so they stay within these limits.

#### Response

**200 OK:**

```json
{
  "bytesWritten": 10485760
}
```

| Status | Error | Cause |
| --- | --- | --- |
| `400` | `Empty chunk` | The chunk body holds no bytes |
| `409` | `Chunk already received` | The chunk index arrived before |
| `413` | `Chunk too large` | Over 16 MiB or over the declared upload size |
| `413` | `Chunks exceed the declared content length` | The chunks of the session together would pass `X-Content-Length` |
| `429` | `Too many parallel chunk requests` | More than `FILE_UPLOAD_CONCURRENT_CHUNKS` requests in flight for the session |
| `429` | `Too many chunks waiting for an earlier one` | 64 chunks already wait for an earlier index |

### POST /api/upload/:id/finalize

Finalize a chunked upload. Verifies total bytes match the declared content length and creates the database record.

#### Request

**Headers:**

| Header | Type | Description |
| --- | --- | --- |
| `X-Owner-Token` | base64url | Ownership token |

#### Response

**200 OK:** Same response as `POST /api/upload`.

**400 Bad Request** (size mismatch):

```json
{
  "error": "Body size does not match declared content length"
}
```

### Chunked Upload Flow

```
POST /api/upload/init          →  201 { id }
POST /api/upload/:id/chunk?index=0  →  200 { bytesWritten }  ┐
POST /api/upload/:id/chunk?index=1  →  200 { bytesWritten }  ├ parallel
POST /api/upload/:id/chunk?index=2  →  200 { bytesWritten }  ┘
...
POST /api/upload/:id/finalize  →  200 { id, url }
POST /api/meta/:id             →  200 { ok }
```

## WebSocket /api/upload/ws

Primary upload transport.  Streams the encrypted payload over a single persistent WebSocket connection, avoiding the HTTP/2 multiplexing bottleneck that reverse proxies (Traefik, Nginx) impose on many parallel `POST /api/upload/:id/chunk` requests.

Controlled by the `FILE_UPLOAD_WS` environment variable (default `true`). When disabled, or when the WebSocket handshake fails for any reason, clients automatically fall back to the HTTP chunked upload flow described above.

### Protocol

1. **Client** opens `wss://<host>/api/upload/ws`.
2. **Client → Server** (text frame, JSON):

   ```json
   {
     "type": "init",
     "headers": {
       "authToken": "…", "ownerToken": "…", "salt": "…",
       "maxDownloads": "3", "expireSec": "3600", "fileCount": "1",
       "contentLength": "12345", "hasPassword": "false"
     }
   }
   ```

   All header values are strings, matching the HTTP upload headers one-to-one. Password-protected uploads additionally include `passwordSalt` and `passwordAlgo`. The server validates the payload identically to the HTTP `POST /api/upload/init` endpoint.
3. **Server → Client** (text, JSON): `{"type":"ready","id":"<uuid>"}`.
4. **Client → Server** (binary frames): contiguous slices of ciphertext. WebSocket guarantees frame ordering on a single connection, so no per-frame index is required. Total bytes must equal `contentLength`.
5. **Client → Server** (text, JSON): `{"type":"finalize"}`.
6. **Server → Client** (text, JSON): `{"type":"done","id":"<uuid>"}`, followed by close code `1000`.

Errors are reported as `{"type":"error","message":"…"}` followed by a non-1000 close code:

| Close code | Cause |
| --- | --- |
| `1002` | Protocol violation (e.g. binary frame after finalize) |
| `1003` | Unsupported data type (e.g. non-JSON control frame) |
| `1008` | Header validation, size mismatch, or quota violation |
| `1009` | Server receive buffer exceeded `FILE_UPLOAD_WS_MAX_BUFFER`, or a single message is larger than 1 MiB |
| `1011` | Internal server error |

### Client Fallback

Clients should treat the following as fallback triggers (retry via HTTP chunks using the same encrypted stream):

- WebSocket `error` event before `ready`
- WebSocket `close` event with a non-1000 code before `ready`
- Handshake timeout (recommended: 10 s)
- Initial `{"type":"error"}` response to `init`

Once the client has begun sending binary frames the encrypted stream has been consumed; failures after that point are fatal and must be surfaced to the user.

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
