# Environment Variables

Complete reference of all environment variables supported by SkySend.

## Server

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `PORT` | ❌ | `3000` | Server port (1-65535). |
| `HOST` | ❌ | `0.0.0.0` | Server bind address. |
| `BASE_URL` | ❌ | `http://localhost:3000` | Public URL of the instance (used for generated links). |
| `DATA_DIR` | ❌ | `./data` | Directory for the database (`DATA_DIR/db/skysend.db`). |
| `UPLOADS_DIR` | ❌ | `{DATA_DIR}/uploads` | Directory for encrypted upload files. In Docker, defaults to `/uploads`. |
| `TRUST_PROXY` | ❌ | `false` | Trust `X-Forwarded-For` and `X-Real-IP` headers. Enable when behind a reverse proxy. |
| `CORS_ORIGINS` | ❌ | _(empty)_ | Additional CORS origins, comma-separated. |

## Upload Limits

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `MAX_FILE_SIZE` | ❌ | `2GB` | Maximum upload size. Supports units: `B`, `KB`, `MB`, `GB`. |
| `MAX_FILES_PER_UPLOAD` | ❌ | `32` | Maximum number of files per multi-file upload. |

## Expiry Options

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `EXPIRE_OPTIONS_SEC` | ❌ | `300,3600,86400,604800` | Comma-separated list of selectable expiry times in seconds. |
| `DEFAULT_EXPIRE_SEC` | ❌ | `86400` | Default expiry time (must be one of `EXPIRE_OPTIONS_SEC`). |

The default options translate to:
- 5 minutes (`300`)
- 1 hour (`3600`)
- 1 day (`86400`) - default
- 7 days (`604800`)

## Download Limits

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `DOWNLOAD_OPTIONS` | ❌ | `1,2,3,4,5,10,20,50,100` | Comma-separated list of selectable download limits. |
| `DEFAULT_DOWNLOAD` | ❌ | `1` | Default download limit (must be one of `DOWNLOAD_OPTIONS`). |

## Cleanup

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `CLEANUP_INTERVAL` | ❌ | `60` | Interval for the automatic cleanup job in seconds. |

## Rate Limiting

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `RATE_LIMIT_WINDOW` | ❌ | `60000` | Rate limit window in milliseconds. |
| `RATE_LIMIT_MAX` | ❌ | `60` | Maximum requests per window per IP. |

## Upload Quota

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `UPLOAD_QUOTA_BYTES` | ❌ | `0` (unlimited) | Maximum upload volume per user per window. `0` disables the quota. Supports units: `B`, `KB`, `MB`, `GB`. |
| `UPLOAD_QUOTA_WINDOW` | ❌ | `86400` | Quota time window in seconds (default: 24 hours). |

::: info Privacy-Preserving Quotas
Upload quotas use HMAC-SHA256 hashed IPs with a daily rotating key. No plaintext IP addresses are stored. The hash key rotates every 24 hours, making it impossible to correlate users across days.
:::

## Branding

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `CUSTOM_TITLE` | ❌ | `SkySend` | Displayed site title in the UI. |
| `CUSTOM_COLOR` | ❌ | _(none)_ | Primary brand color as 6-digit hex code (e.g. `46c89d`). The `#` prefix is optional. |
| `CUSTOM_LOGO` | ❌ | _(none)_ | URL or absolute path to a custom logo (e.g. `https://example.com/logo.svg` or `/custom-logo.svg`). |

::: tip Example
```yaml
# docker-compose.yml
environment:
  CUSTOM_TITLE: MyShare
  CUSTOM_COLOR: ff6b35
  CUSTOM_LOGO: "https://example.com/my-logo.svg"
```

::: tip
The `#` prefix is optional for `CUSTOM_COLOR`. Both `ff6b35` and `#ff6b35` are valid. Omitting the `#` avoids quoting issues in `.env` files.
:::

## Docker

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `PUID` | ❌ | `1001` | User ID the container runs as. |
| `PGID` | ❌ | `1001` | Group ID the container runs as. |

## Validation

SkySend validates all environment variables on startup using Zod:

- `DEFAULT_EXPIRE_SEC` must be one of the values in `EXPIRE_OPTIONS_SEC`
- `DEFAULT_DOWNLOAD` must be one of the values in `DOWNLOAD_OPTIONS`
- `PORT` must be between 1 and 65535
- `MAX_FILE_SIZE` must be a valid byte size string
- `BASE_URL` must be a valid URL (trailing slashes are stripped automatically)
- `CUSTOM_COLOR` must be a valid 6-digit hex color code (with or without `#` prefix)
- `CUSTOM_LOGO` must be a URL or an absolute path starting with `/`

If any variable is invalid, the server will fail to start with a descriptive error message.
