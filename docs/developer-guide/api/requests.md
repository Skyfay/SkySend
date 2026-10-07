# File Requests API

A file request lets senders upload into an inbox that only the requester can open. There are two route families: `/api/request` for creating a request and for uploading into it, and `/api/inbox` for everything the requester does afterwards. Both answer `403` when `request` is not in `ENABLED_SERVICES`, and `/api/config` reports the feature as `fileRequestsEnabled`.

The server never receives a key, the request's public key, a file name, the brief or a note in plain text. How the client builds what it sends is on the [File Requests cryptography page](/developer-guide/crypto/file-requests).

Every binary field is canonical base64url without padding, checked for its exact length. Any other spelling of the same bytes is refused.

## Tokens

| Header | Derived from | Grants |
| --- | --- | --- |
| `X-Upload-Token` | The upload link | Reading what a sender sees, opening an upload |
| `X-Inbox-Token` | The inbox link | Listing the inbox, downloading a file |
| `X-Inbox-Owner-Token` | The inbox link | Deleting a file, closing and deleting the request |

A missing or wrong token answers `404`, the same as a request that does not exist. On the inbox routes of a request with a password, a well-formed wrong token also counts as a failed attempt for the lockout `request:<id>` of the caller's IP, shared with the password and note routes. After `PASSWORD_MAX_ATTEMPTS` failures every inbox route answers `429` with `Retry-After` for `PASSWORD_LOCKOUT_MS`. A request without a password never locks, since its tokens come from 256 random bits, and neither does an ID that does not exist.

## POST /api/request

Create a request. Needs the OIDC session when `OIDC_PROTECT_FILES` is on.

```json
{
  "vault": "<146 bytes>",
  "vaultNonce": "<12 bytes>",
  "inboxAuthToken": "<32 bytes>",
  "inboxOwnerToken": "<32 bytes>",
  "uploadToken": "<32 bytes>",
  "brief": { "ciphertext": "<1040 to 8208 bytes>", "nonce": "<12 bytes>" },
  "expireSec": 259200,
  "maxUploads": 10,
  "maxSize": 2147483648,
  "downloads": 5,
  "hasPassword": false
}
```

| Field | Rule |
| --- | --- |
| `brief` | Required. The ciphertext is 16 bytes longer than a multiple of 1024, see [the brief](/developer-guide/crypto/file-requests#the-brief) |
| `expireSec` | One of `FILE_REQUEST_EXPIRE_OPTIONS_SEC` |
| `maxUploads` | One of `FILE_REQUEST_UPLOAD_OPTIONS`, or twice one. A request for files and a note counts submissions with the options, and each takes two uploads. The server cannot tell what a request asks for, so any request may take up to twice the largest option. |
| `maxSize` | Most bytes one upload may have, at most `FILE_REQUEST_MAX_SIZE` |
| `downloads` | How often the requester can download each upload, one of `FILE_REQUEST_DOWNLOAD_OPTIONS` |
| `hasPassword` | Must be `true` when `FORCE_REQUEST_PASSWORD` is on. The server takes the client's word for it, since the password never reaches it. |

Unknown fields are refused, and the body may be at most 16 KB.

| Status | Body |
| --- | --- |
| `201` | `{ "id": "<uuid>", "closesAt": "<ISO date>" }` |
| `400` | Invalid body or a limit the server does not allow |
| `401` | Login required |
| `413` | Body too large |
| `429` | `FILE_REQUEST_DAILY_LIMIT` used up for this user or IP |

## GET /api/request/limit

How many new requests the caller has left today, counted the way creating one counts them: by OIDC user where creating needs a login, by IP otherwise. Asking counts nothing. Needs the OIDC session when `OIDC_PROTECT_FILES` is on.

With `FILE_REQUEST_DAILY_LIMIT=100`:

```json
{ "dailyLimit": 100, "remaining": 97, "resetsAt": null }
```

`resetsAt` is set only once `remaining` is `0`, since people behind one IP share a count, and the end of the day would tell one of them when another created a request. With `FILE_REQUEST_DAILY_LIMIT` at `0`, `dailyLimit` is `0` and the other two are `null`.

## GET /api/request/:id

What a sender sees. Needs `X-Upload-Token`.

```json
{
  "brief": { "ciphertext": "...", "nonce": "..." },
  "open": true,
  "closesAt": "2026-10-09T12:00:00.000Z",
  "uploadsLeft": 9,
  "maxUploadSize": 2147483648,
  "maxFilesPerUpload": 32
}
```

`maxUploadSize` is the smaller of `FILE_MAX_SIZE` and the `maxSize` of the request. A closed or expired request answers `open: false` with `uploadsLeft` and `maxUploadSize` at `0`.

## Uploading Into a Request

Uploads take the same two transports as [normal uploads](/developer-guide/api/upload): the WebSocket when `FILE_UPLOAD_WS` is on, and chunked HTTP otherwise or when the WebSocket cannot connect. Both share the session layer of normal uploads and its limits. The sender's upload quota applies, and the slot is reserved at init on either transport. A WebSocket session that delivers less than 1 MiB, or less than the rest of its upload, in 10 minutes is ended and gives its slot back.

### GET /api/request/:id/upload/ws

The WebSocket transport of normal uploads, with the same frames, buffering, backpressure and keepalive. Only the init and the finalize frame differ:

```json
{ "type": "init", "request": { "uploadToken": "<32 bytes>", "salt": "<32 bytes>", "contentLength": 1048624, "fileCount": 1 } }
```

```json
{ "type": "finalize", "wrapEnc": "<65 bytes>", "wrapCiphertext": "<48 bytes>", "encryptedMeta": "<17 to 75000 bytes>", "metaNonce": "<12 bytes>" }
```

The server answers `{ "type": "ready", "id": "<upload uuid>" }`, then `{ "type": "done", "id" }` once the upload is stored. A refusal is `{ "type": "error", "message", "status" }`, where `status` is the one the same refusal has over HTTP, for example `404` for a wrong upload token or `409` for a full request. A socket that closes before `done` gives its slot back at once.

### Chunked HTTP

The same chunk rules as [normal chunked uploads](/developer-guide/api/upload): at most 16 MiB per chunk, every index once, at most `FILE_UPLOAD_CONCURRENT_CHUNKS` chunks in flight, no empty chunk. Chunk requests skip the global rate limiter.

### POST /api/request/:id/upload/init

Needs `X-Upload-Token`, plus:

| Header | Value |
| --- | --- |
| `X-Salt` | 32-byte HKDF salt of the file |
| `X-Content-Length` | Encrypted size, at most `FILE_MAX_SIZE` |
| `X-File-Count` | Files in the upload, at most `FILE_MAX_FILES_PER_UPLOAD`, default `1` |

Init reserves a slot in one statement, which also checks the declared size against the `maxSize` of the request, so parallel senders can never overfill a request. A session that fails or times out gives its slot back, and so does a restart of the server.

| Status | Meaning |
| --- | --- |
| `201` | `{ "id": "<upload uuid>" }`, the ID the wrap of the file secret binds |
| `400` | Invalid headers, or more files than `FILE_MAX_FILES_PER_UPLOAD` |
| `403` | File requests are disabled |
| `404` | Unknown request or wrong upload token |
| `409` | Every slot is taken |
| `410` | The request is closed or expired |
| `413` | Larger than `FILE_MAX_SIZE`, than the `maxSize` of the request, or than the sender's remaining upload quota |
| `429` | The sender's upload quota or the rate limit is used up |

### POST /api/request/:id/upload/:uid/chunk?index=N

The encrypted bytes of chunk `N`, as for a normal upload. A session of another request answers `404`.

### DELETE /api/request/:id/upload/:uid

Ends an upload the sender cancelled, so its slot is free again at once instead of when the session times out after an hour. The upload ID came only from init, so knowing it is what allows this. Answers `{ "ok": true }`, or `404` for an unknown session or one of another request.

### POST /api/request/:id/upload/:uid/finalize

```json
{
  "wrapEnc": "<65 bytes>",
  "wrapCiphertext": "<48 bytes>",
  "encryptedMeta": "<17 to 75000 bytes>",
  "metaNonce": "<12 bytes>"
}
```

The body is checked before the session ends, so a broken body can be sent again. Then the upload is stored with the `downloads` of its request and deleted `FILE_REQUEST_RETENTION_SEC` after it arrived.

| Status | Meaning |
| --- | --- |
| `200` | `{ "id": "<upload uuid>" }` |
| `400` | Invalid body, which keeps the session so it can be sent again. Or fewer bytes arrived than declared, which ends the session and gives the reservation back. |
| `404` | Unknown session, or the request was deleted while the upload ran |
| `413` | Body over 128 KB |

## GET /api/inbox/:id

Needs `X-Inbox-Token`. Never counts as a download.

```json
{
  "vault": "...",
  "vaultNonce": "...",
  "brief": { "ciphertext": "...", "nonce": "..." },
  "hasPassword": false,
  "open": true,
  "closesAt": "2026-10-09T12:00:00.000Z",
  "createdAt": "2026-10-06T12:00:00.000Z",
  "maxUploads": 10,
  "maxSize": 2147483648,
  "usedUploads": 1,
  "usedBytes": 1048624,
  "uploads": [
    {
      "id": "<upload uuid>",
      "size": 1048624,
      "fileCount": 1,
      "salt": "...",
      "wrapEnc": "...",
      "wrapCiphertext": "...",
      "encryptedMeta": "...",
      "metaNonce": "...",
      "downloadCount": 0,
      "maxDownloads": 5,
      "expiresAt": "2026-10-13T12:00:00.000Z",
      "createdAt": "2026-10-06T12:00:00.000Z"
    }
  ]
}
```

`usedUploads` and `usedBytes` count the uploads that finished, deleted ones included, because a deleted upload keeps its slot. `maxSize` is the most bytes one upload may have. `uploads` holds only the ones that can still be downloaded.

## GET /api/inbox/:id/file/:uid

Needs `X-Inbox-Token`. Counts one download atomically and streams the ciphertext, or answers `{ "url", "size", "fileCount" }` with a presigned URL on S3, like [`GET /api/download/:id`](/developer-guide/api/download). An upload that expired or used up its downloads answers `410`. A file of a request is only ever reachable here, never through `/api/download`, `/api/info` or `/api/exists`.

## Managing a Request

All three need `X-Inbox-Owner-Token` and answer `{ "ok": true }`.

| Route | Effect |
| --- | --- |
| `DELETE /api/inbox/:id/file/:uid` | Deletes one upload. Its slot stays used. |
| `POST /api/inbox/:id/close` | Stops new uploads. Sessions already running still finish. |
| `DELETE /api/inbox/:id` | Deletes the request and every upload in it |
