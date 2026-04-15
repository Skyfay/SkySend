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

Returns server limits and options for the client UI.

**Response:**

```json
{
  "maxFileSize": 2147483648,
  "maxFilesPerUpload": 32,
  "expireOptions": [300, 3600, 86400, 604800],
  "defaultExpire": 86400,
  "downloadOptions": [1, 2, 3, 4, 5, 10, 20, 50, 100],
  "defaultDownload": 1,
  "customTitle": "SkySend",
  "customColor": null,
  "customLogo": null
}
```

## Health Check

### GET /api/health

Simple health check for monitoring and Docker health checks.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```
