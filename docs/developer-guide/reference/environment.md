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
- `CUSTOM_COLOR` must be a 6-digit hex color code (with or without `#` prefix)
- `CUSTOM_LOGO` must be a URL or an absolute path starting with `/`
- `CUSTOM_PRIVACY` must be a valid URL
- `CUSTOM_LEGAL` must be a valid URL
- `CUSTOM_LINK_URL` must be a valid URL
- `CUSTOM_LINK_NAME` must be at most 50 characters
