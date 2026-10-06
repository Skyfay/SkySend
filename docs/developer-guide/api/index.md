# API Overview

SkySend exposes a REST API under the `/api` prefix. All endpoints accept and return JSON unless otherwise noted.

## Base URL

```
http://localhost:3000/api
```

## Endpoints

### File Endpoints

| Method | Path | Description | Auth |
| --- | --- | --- | --- |
| `GET` | `/api/config` | Server configuration (limits) | - |
| `GET` | `/api/quota` | Upload quota status for the client IP | - |
| `POST` | `/api/upload` | Upload encrypted file stream | - |
| `POST` | `/api/upload/init` | Initialize chunked upload session | - |
| `POST` | `/api/upload/:id/chunk` | Append chunk (with `?index=N`) | - |
| `POST` | `/api/upload/:id/finalize` | Finalize chunked upload | Owner Token |
| `POST` | `/api/meta/:id` | Save encrypted metadata | Owner Token |
| `GET` | `/api/info/:id` | Upload info (size, expiry, downloads) | - |
| `GET` | `/api/download/:id` | Download encrypted file stream | Auth Token |
| `POST` | `/api/password/:id` | Verify file password | - |
| `DELETE` | `/api/upload/:id` | Delete upload | Owner Token |
| `GET` | `/api/exists/:id` | Check if upload exists | - |
| `GET` | `/api/health` | Health check | - |

### Note Endpoints

| Method | Path | Description | Auth |
| --- | --- | --- | --- |
| `POST` | `/api/note` | Create encrypted note | - |
| `GET` | `/api/note/:id` | Note info (type, views, expiry) | - |
| `POST` | `/api/note/:id/view` | View note (returns encrypted content) | Auth Token |
| `POST` | `/api/note/:id/password` | Verify note password | - |
| `DELETE` | `/api/note/:id` | Delete note | Owner Token |

### File Request Endpoints

Active when `request` is in `ENABLED_SERVICES`. See [File Requests](/developer-guide/api/requests).

| Method | Path | Description | Auth |
| --- | --- | --- | --- |
| `POST` | `/api/request` | Create a file request | OIDC when `OIDC_PROTECT_FILES` |
| `GET` | `/api/request/:id` | What a sender sees | Upload Token |
| `GET` | `/api/request/:id/upload/ws` | WebSocket upload into the request | Upload Token in the init frame |
| `POST` | `/api/request/:id/upload/init` | Open an upload into the request | Upload Token |
| `POST` | `/api/request/:id/upload/:uid/chunk` | Append chunk (with `?index=N`) | Upload session |
| `POST` | `/api/request/:id/upload/:uid/finalize` | Store the upload with its wrapped key | Upload session |
| `DELETE` | `/api/request/:id/upload/:uid` | Cancel an upload and free its slot | Upload session |
| `GET` | `/api/inbox/:id` | Vault and uploads of the inbox | Inbox Token |
| `GET` | `/api/inbox/:id/file/:uid` | Download one upload | Inbox Token |
| `DELETE` | `/api/inbox/:id/file/:uid` | Delete one upload | Inbox Owner Token |
| `POST` | `/api/inbox/:id/close` | Stop new uploads | Inbox Owner Token |
| `DELETE` | `/api/inbox/:id` | Delete the request and its uploads | Inbox Owner Token |

### OIDC Auth Endpoints

These routes are only active when OIDC is configured (i.e., when `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` are all set). They live outside the `/api` prefix.

| Method | Path | Description | Auth |
| --- | --- | --- | --- |
| `GET` | `/auth/login` | Start PKCE login, redirect to provider | - |
| `GET` | `/auth/callback` | Handle provider callback, issue session | - |
| `GET` | `/auth/logout` | Clear session, redirect to provider end-session | Session cookie |
| `GET` | `/auth/session` | Return current user info | Session cookie / Bearer |

See [OIDC Authentication](/developer-guide/api/oidc) for the full flow and access-control details.

## Authentication

SkySend uses two token types, both derived from the client-side secret:

### Auth Token (`X-Auth-Token`)
Required for downloading files. Derived from the secret via HKDF + HMAC-SHA256. Proves the requester knows the encryption key.

### Owner Token (`X-Owner-Token`)
Required for deleting uploads and saving metadata. Derived from the secret via HKDF. Proves upload ownership.

Both tokens are provided as base64url-encoded strings in request headers.

## Common Response Codes

| Code | Meaning |
| --- | --- |
| `200` | Success |
| `400` | Invalid request (missing/invalid parameters) |
| `401` | Invalid or missing auth token |
| `404` | Upload not found |
| `409` | Conflict (e.g., metadata already set) |
| `410` | Upload expired or download limit reached |
| `429` | Rate limit or quota exceeded |
| `500` | Internal server error |

## Rate Limiting

All endpoints are rate-limited. Response headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1704067260000
```

## Server Configuration

### GET /api/config

Returns server limits and options for the client UI. Each field comes from the [environment variable](/user-guide/configuration/environment-variables) of the same name.

`enabledServices` lists `file` and `note` only. File requests are reported as `fileRequestsEnabled`, because CLI clients before v4 refuse a config whose `enabledServices` holds anything else.

**Response:**

```json
{
  "enabledServices": ["file", "note"],
  "fileMaxSize": 2147483648,
  "fileMaxFilesPerUpload": 32,
  "fileExpireOptions": [300, 3600, 86400, 604800],
  "fileDefaultExpire": 86400,
  "fileDownloadOptions": [1, 2, 3, 4, 5, 10, 20, 50, 100],
  "fileDefaultDownload": 1,
  "fileUploadQuotaBytes": 0,
  "fileUploadQuotaWindow": 86400,
  "fileUploadConcurrentChunks": 3,
  "fileUploadSpeedLimit": 0,
  "fileUploadWs": true,
  "fileRequestsEnabled": true,
  "fileRequestExpireOptions": [86400, 259200, 604800],
  "fileRequestDefaultExpire": 259200,
  "fileRequestMaxUploads": 10,
  "fileRequestMaxSize": 2147483648,
  "fileRequestRetention": 604800,
  "fileRequestDownloads": 5,
  "noteMaxSize": 1048576,
  "noteExpireOptions": [300, 3600, 86400, 604800],
  "noteDefaultExpire": 86400,
  "noteViewOptions": [0, 1, 2, 3, 5, 10, 20, 50, 100],
  "noteDefaultViews": 0,
  "noteBlocks": true,
  "customTitle": "SkySend",
  "customColor": null,
  "customLogo": null,
  "customPrivacy": null,
  "customLegal": null,
  "customLinkUrl": null,
  "customLinkName": null,
  "customReportUrl": null,
  "defaultTheme": "graphite",
  "defaultColorScheme": "system",
  "defaultTab": "file",
  "forceFilePassword": false,
  "forceNotePassword": false,
  "oidcEnabled": false,
  "oidcProtectFiles": false,
  "oidcProtectNotes": false
}
```

`noteBlocks` is `true` on servers that accept notes made of blocks, which is every server since v3. A client checks it before it creates such a note and falls back to a legacy content type on an older server, where the field is missing.

## Health Check

### GET /api/health

Simple health check for monitoring and Docker health checks.

**Response:**

```json
{
  "status": "ok",
  "version": "2.11.3",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```
