# Environment Variables Reference

Complete reference of all environment variables, their types, defaults, and validation rules.

## Overview

All environment variables are validated on startup using Zod. Invalid values cause the server to fail with a descriptive error message. None of the variables are strictly required - all have sensible defaults for local development. For Docker deployments, `DATA_DIR` and `UPLOADS_DIR` are set automatically in the image.

::: warning v2.0.0 Breaking Change
All file-related variables have been renamed with a `FILE_` prefix (e.g. `MAX_FILE_SIZE` -> `FILE_MAX_SIZE`). Old names are no longer supported. See the migration table below.
:::

### Migration from v1.x

| Old Name (v1) | New Name (v2) |
| --- | --- |
| `MAX_FILE_SIZE` | `FILE_MAX_SIZE` |
| `MAX_FILES_PER_UPLOAD` | `FILE_MAX_FILES_PER_UPLOAD` |
| `EXPIRE_OPTIONS_SEC` | `FILE_EXPIRE_OPTIONS_SEC` |
| `DEFAULT_EXPIRE_SEC` | `FILE_DEFAULT_EXPIRE_SEC` |
| `DOWNLOAD_OPTIONS` | `FILE_DOWNLOAD_OPTIONS` |
| `DEFAULT_DOWNLOAD` | `FILE_DEFAULT_DOWNLOAD` |
| `UPLOAD_QUOTA_BYTES` | `FILE_UPLOAD_QUOTA_BYTES` |
| `UPLOAD_QUOTA_WINDOW` | `FILE_UPLOAD_QUOTA_WINDOW` |

## Variables

### PORT

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `3000` |
| Range | 1 - 65535 |
| Description | Server listening port |

### HOST

| Property | Value |
| --- | --- |
| Required | No |
| Type | String |
| Default | `0.0.0.0` |
| Description | Server bind address |

### BASE_URL

| Property | Value |
| --- | --- |
| Required | **Yes** |
| Type | URL |
| Default | - |
| Description | Public URL of the instance. Trailing slashes are stripped automatically. |

### DATA_DIR

| Property | Value |
| --- | --- |
| Required | No |
| Type | String (path) |
| Default | `./data` |
| Description | Directory for the database. The SQLite DB is stored at `DATA_DIR/db/skysend.db`. |

### UPLOADS_DIR

| Property | Value |
| --- | --- |
| Required | No |
| Type | String (path) |
| Default | `DATA_DIR/uploads` |
| Description | Directory for encrypted upload files. Falls back to `DATA_DIR/uploads` if not set. In Docker, defaults to `/uploads` for separate volume mounting. |

### FILE_MAX_SIZE

| Property | Value |
| --- | --- |
| Required | No |
| Type | Byte size string |
| Default | `2GB` |
| Description | Maximum upload size. Supports: `B`, `KB`, `MB`, `GB` |

### FILE_MAX_FILES_PER_UPLOAD

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `32` |
| Range | >= 1 |
| Description | Maximum files per multi-file upload |

### FILE_EXPIRE_OPTIONS_SEC

| Property | Value |
| --- | --- |
| Required | No |
| Type | Comma-separated integers |
| Default | `300,3600,86400,604800` |
| Description | Selectable expiry times in seconds for file uploads |

### FILE_DEFAULT_EXPIRE_SEC

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `86400` |
| Validation | Must be one of `FILE_EXPIRE_OPTIONS_SEC` |
| Description | Default expiry time for file uploads |

### FILE_DOWNLOAD_OPTIONS

| Property | Value |
| --- | --- |
| Required | No |
| Type | Comma-separated integers |
| Default | `1,2,3,4,5,10,20,50,100` |
| Description | Selectable download limits for file uploads |

### FILE_DEFAULT_DOWNLOAD

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `1` |
| Validation | Must be one of `FILE_DOWNLOAD_OPTIONS` |
| Description | Default download limit for file uploads |

### FILE_UPLOAD_QUOTA_BYTES

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer (bytes) or byte size string |
| Default | `0` (disabled) |
| Description | Maximum upload volume per user per window. `0` disables quotas. Supports raw bytes or units: `B`, `KB`, `MB`, `GB` |

### FILE_UPLOAD_QUOTA_WINDOW

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer (seconds) |
| Default | `86400` |
| Description | Quota time window for file upload quotas |

### FILE_UPLOAD_CONCURRENT_CHUNKS

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `3` |
| Range | 1 - 20 |
| Description | Number of parallel chunk uploads per session. Increase to improve upload speed in Chromium browsers through HTTP/2 reverse proxies. The value is exposed via `/api/config` and read by the client upload worker |

### FILE_UPLOAD_SPEED_LIMIT

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer (bytes/s) or byte size string |
| Default | `0` (unlimited) |
| Description | Maximum upload throughput per session. `0` disables the limit. Supports raw bytes or units: `B`, `KB`, `MB`, `GB` (e.g. `100MB` for 100 MB/s). The server delays chunk responses to enforce the limit |

### FILE_UPLOAD_WS

| Property | Value |
| --- | --- |
| Required | No |
| Type | Boolean |
| Default | `true` |
| Description | Enable the WebSocket upload transport at `/api/upload/ws`. Clients prefer WebSocket and fall back to HTTP chunked uploads automatically if the handshake fails. Set to `false` to disable the endpoint entirely |

### FILE_UPLOAD_WS_MAX_BUFFER

| Property | Value |
| --- | --- |
| Required | No |
| Type | Byte size string |
| Default | `16MB` |
| Minimum | `1MB` |
| Description | Maximum bytes the server buffers in memory per WebSocket upload session before aborting it with close code `1009`. Only relevant when the storage backend falls behind the incoming frame rate |

### NOTE_MAX_SIZE

| Property | Value |
| --- | --- |
| Required | No |
| Type | Byte size string |
| Default | `1MB` |
| Description | Maximum plaintext note size before encryption. Supports: `B`, `KB`, `MB`, `GB` |

### NOTE_EXPIRE_OPTIONS_SEC

| Property | Value |
| --- | --- |
| Required | No |
| Type | Comma-separated integers |
| Default | `300,3600,86400,604800` |
| Description | Selectable expiry times in seconds for notes |

### NOTE_DEFAULT_EXPIRE_SEC

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `86400` |
| Validation | Must be one of `NOTE_EXPIRE_OPTIONS_SEC` |
| Description | Default expiry time for notes |

### NOTE_VIEW_OPTIONS

| Property | Value |
| --- | --- |
| Required | No |
| Type | Comma-separated integers |
| Default | `0,1,2,3,5,10,20,50,100` |
| Description | Selectable view limits for notes. `0` means unlimited views (the note expires only by time). |

### NOTE_DEFAULT_VIEWS

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `0` |
| Validation | Must be one of `NOTE_VIEW_OPTIONS` |
| Description | Default view limit for notes. `0` means unlimited views (expires only by time). `1` means burn-after-reading. |

### ENABLED_SERVICES

| Property | Value |
| --- | --- |
| Required | No |
| Type | Comma-separated list |
| Default | `file,note` |
| Allowed values | `file`, `note` |
| Validation | At least one service must be enabled |
| Description | Controls which services are available. Set to `file` for file sharing only, `note` for notes only, or `file,note` for both. Disabled services return HTTP 403 and their UI tabs are hidden. |

### CLEANUP_INTERVAL

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer (seconds) |
| Default | `60` |
| Description | Interval for the automatic cleanup job |

### CUSTOM_TITLE

| Property | Value |
| --- | --- |
| Required | No |
| Type | String |
| Default | `SkySend` |
| Description | Displayed site title |

### RATE_LIMIT_WINDOW

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer (milliseconds) |
| Default | `60000` |
| Description | Rate limit sliding window size |

### RATE_LIMIT_MAX

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `60` |
| Description | Maximum requests per window per IP |

### TRUST_PROXY

| Property | Value |
| --- | --- |
| Required | No |
| Type | Boolean |
| Default | `false` |
| Description | Trust `X-Forwarded-For` / `X-Real-IP` headers from reverse proxy |

### CUSTOM_COLOR

| Property | Value |
| --- | --- |
| Required | No |
| Type | Hex color code |
| Default | - (uses default theme) |
| Validation | Must match 6 hex digits, e.g. `46c89d` (the `#` prefix is optional) |
| Description | Primary brand color for the web UI. Overrides the default primary color on buttons, links, icons, and other accented elements. |

### CUSTOM_LOGO

| Property | Value |
| --- | --- |
| Required | No |
| Type | URL or absolute path |
| Default | - (uses built-in SkySend logo) |
| Validation | Must be a URL (`https://...`) or an absolute path (`/...`) |
| Description | URL or path to a custom logo image displayed in the web app header and as favicon. For local files, place them in the `public/` directory (e.g. `public/custom-logo.svg`) and reference as `/custom-logo.svg`. |

### CUSTOM_PRIVACY

| Property | Value |
| --- | --- |
| Required | No |
| Type | URL |
| Default | - (not shown in footer) |
| Validation | Must be a valid URL (`https://...`) |
| Description | URL to your privacy policy page. When set, a "Privacy Policy" link is displayed in the footer. |

### CUSTOM_LEGAL

| Property | Value |
| --- | --- |
| Required | No |
| Type | URL |
| Default | - (not shown in footer) |
| Validation | Must be a valid URL (`https://...`) |
| Description | URL to your legal notice / impressum page. When set, a "Legal Notice" link is displayed in the footer. |

### CUSTOM_LINK_URL

| Property | Value |
| --- | --- |
| Required | No |
| Type | URL |
| Default | - (not shown in footer) |
| Validation | Must be a valid URL (`https://...`) |
| Description | URL for a custom footer link. Must be used together with `CUSTOM_LINK_NAME`. |

### CUSTOM_LINK_NAME

| Property | Value |
| --- | --- |
| Required | No |
| Type | String |
| Default | - |
| Validation | Max 50 characters |
| Description | Display text for the custom footer link defined by `CUSTOM_LINK_URL`. Both variables must be set for the link to appear. |

### STORAGE_BACKEND

| Property | Value |
| --- | --- |
| Required | No |
| Type | Enum |
| Default | `filesystem` |
| Allowed values | `filesystem`, `s3` |
| Description | Storage backend for encrypted upload files. `filesystem` stores files on the local disk. `s3` uses S3-compatible object storage with presigned download URLs. |

### S3_BUCKET

| Property | Value |
| --- | --- |
| Required | When `STORAGE_BACKEND=s3` |
| Type | String |
| Default | - |
| Description | S3 bucket name for upload storage |

### S3_REGION

| Property | Value |
| --- | --- |
| Required | When `STORAGE_BACKEND=s3` |
| Type | String |
| Default | - |
| Description | S3 region (e.g. `eu-central-1`, `auto` for R2) |

### S3_ENDPOINT

| Property | Value |
| --- | --- |
| Required | No (required for non-AWS providers) |
| Type | URL |
| Default | - (uses AWS S3 default) |
| Validation | Must be a valid URL |
| Description | Custom S3 endpoint for non-AWS providers. Examples: `https://<id>.r2.cloudflarestorage.com` (R2), `https://fsn1.your-objectstorage.com` (Hetzner), `https://minio.example.com:9000` (MinIO) |

### S3_ACCESS_KEY

| Property | Value |
| --- | --- |
| Required | When `STORAGE_BACKEND=s3` |
| Type | String |
| Default | - |
| Description | S3 access key ID |

### S3_SECRET_KEY

| Property | Value |
| --- | --- |
| Required | When `STORAGE_BACKEND=s3` |
| Type | String |
| Default | - |
| Description | S3 secret access key |

### S3_FORCE_PATH_STYLE

| Property | Value |
| --- | --- |
| Required | No |
| Type | Boolean |
| Default | `false` |
| Description | Use path-style URLs (`https://endpoint/bucket/key`) instead of virtual-hosted-style (`https://bucket.endpoint/key`). Required for MinIO, Garage, and some self-hosted S3 providers. |

### S3_PRESIGNED_EXPIRY

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer (seconds) |
| Default | `300` |
| Description | TTL for presigned download URLs. S3 validates the signature only at the start of the download - a download that starts within the TTL will complete even if it takes longer. Only used when `S3_PUBLIC_URL` is not set. |

### S3_PUBLIC_URL

| Property | Value |
| --- | --- |
| Required | No |
| Type | URL |
| Default | _(none)_ |
| Description | Public base URL for downloading files directly (e.g. `https://cdn.example.com`). When set, downloads use `{S3_PUBLIC_URL}/{id}.bin` instead of presigned URLs. Recommended for Cloudflare R2 custom domains and other publicly accessible buckets. Since files are E2E encrypted, public access to the raw ciphertext is safe. |

### S3_PART_SIZE

| Property | Value |
| --- | --- |
| Required | No |
| Type | Byte size (e.g. `25MB`, `50MB`) |
| Default | `25MB` |
| Minimum | `5MB` |
| Maximum | `5GB` |
| Description | Size of each S3 multipart upload part. Larger values reduce the number of API round-trips but increase memory usage per upload. The S3 protocol requires at least 5MB per part (except the final part). Increase this if you have high bandwidth and want faster uploads. |

### S3_CONCURRENCY

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `4` |
| Range | 1-16 |
| Description | Number of S3 multipart upload parts uploaded in parallel. Higher values improve throughput by overlapping network transfers, but increase memory and bandwidth usage. Good starting values: `4` for most setups, `8` for high-bandwidth connections. |

### PUID

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `1001` |
| Docker only | Yes |
| Description | User ID the container process runs as. Handled by the entrypoint script. |

### PGID

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `1001` |
| Docker only | Yes |
| Description | Group ID the container process runs as. Handled by the entrypoint script. |

## Validation Rules

- `ENABLED_SERVICES` must contain at least one of `file` or `note`
- `FILE_DEFAULT_EXPIRE_SEC` must be included in `FILE_EXPIRE_OPTIONS_SEC` (only validated when file service is enabled)
- `FILE_DEFAULT_DOWNLOAD` must be included in `FILE_DOWNLOAD_OPTIONS` (only validated when file service is enabled)
- `NOTE_DEFAULT_EXPIRE_SEC` must be included in `NOTE_EXPIRE_OPTIONS_SEC` (only validated when note service is enabled)
- `NOTE_DEFAULT_VIEWS` must be included in `NOTE_VIEW_OPTIONS` (only validated when note service is enabled)
- When `STORAGE_BACKEND=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` are required
- `S3_ENDPOINT` must be a valid URL when set
- `S3_PUBLIC_URL` must be a valid URL when set
- `PORT` must be between 1 and 65535
- `FILE_MAX_SIZE` must be a valid byte size string with a recognized unit
- `NOTE_MAX_SIZE` must be a valid byte size string with a recognized unit
- `BASE_URL` must be a valid URL
- `CUSTOM_COLOR` must be a 6-digit hex color code (with or without `#` prefix)
- `CUSTOM_LOGO` must be a URL or an absolute path starting with `/`
- `CUSTOM_PRIVACY` must be a valid URL
- `CUSTOM_LEGAL` must be a valid URL
- `CUSTOM_LINK_URL` must be a valid URL
- `CUSTOM_LINK_NAME` must be at most 50 characters
