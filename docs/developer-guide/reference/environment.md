# Environment Variables Reference

Complete reference of all environment variables, their types, defaults, and validation rules.

## Overview

All environment variables are validated on startup using Zod. Invalid values cause the server to fail with a descriptive error message. None of the variables are strictly required - all have sensible defaults for local development. For Docker deployments, `DATA_DIR` and `UPLOADS_DIR` are set automatically in the image.

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
| Required | No |
| Type | URL |
| Default | `http://localhost:3000` |
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

### MAX_FILE_SIZE

| Property | Value |
| --- | --- |
| Required | No |
| Type | Byte size string |
| Default | `2GB` |
| Description | Maximum upload size. Supports: `B`, `KB`, `MB`, `GB` |

### MAX_FILES_PER_UPLOAD

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `32` |
| Range | >= 1 |
| Required | No |
| Description | Maximum files per multi-file upload |

### EXPIRE_OPTIONS_SEC

| Property | Value |
| --- | --- |
| Required | No |
| Type | Comma-separated integers |
| Default | `300,3600,86400,604800` |
| Description | Selectable expiry times in seconds |

### DEFAULT_EXPIRE_SEC

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `86400` |
| Validation | Must be one of `EXPIRE_OPTIONS_SEC` |
| Description | Default expiry time |

### DOWNLOAD_OPTIONS

| Property | Value |
| --- | --- |
| Required | No |
| Type | Comma-separated integers |
| Default | `1,2,3,4,5,10,20,50,100` |
| Description | Selectable download limits |

### DEFAULT_DOWNLOAD

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer |
| Default | `1` |
| Validation | Must be one of `DOWNLOAD_OPTIONS` |
| Description | Default download limit |

### CLEANUP_INTERVAL

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer (seconds) |
| Default | `60` |
| Description | Interval for the automatic cleanup job |

### SITE_TITLE

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

### UPLOAD_QUOTA_BYTES

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer (bytes) or byte size string |
| Default | `0` (disabled) |
| Description | Maximum upload volume per user per window. `0` disables quotas. Supports raw bytes or units: `B`, `KB`, `MB`, `GB` |

### UPLOAD_QUOTA_WINDOW

| Property | Value |
| --- | --- |
| Required | No |
| Type | Integer (seconds) |
| Default | `86400` |
| Description | Quota time window |

### TRUST_PROXY

| Property | Value |
| --- | --- |
| Required | No |
| Type | Boolean |
| Default | `false` |
| Description | Trust `X-Forwarded-For` / `X-Real-IP` headers from reverse proxy |

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

- `DEFAULT_EXPIRE_SEC` must be included in `EXPIRE_OPTIONS_SEC`
- `DEFAULT_DOWNLOAD` must be included in `DOWNLOAD_OPTIONS`
- `PORT` must be between 1 and 65535
- `MAX_FILE_SIZE` must be a valid byte size string with a recognized unit
- `BASE_URL` must be a valid URL
