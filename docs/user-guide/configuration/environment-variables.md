# Environment Variables

Complete reference of all environment variables supported by SkySend.

## Server

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Server port (1-65535) |
| `HOST` | `0.0.0.0` | Server bind address |
| `BASE_URL` | `http://localhost:3000` | Public URL of the instance (used for generated links) |
| `DATA_DIR` | `./data` | Directory for database and uploaded files |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` and `X-Real-IP` headers. Enable when behind a reverse proxy. |

## Upload Limits

| Variable | Default | Description |
| --- | --- | --- |
| `MAX_FILE_SIZE` | `2GB` | Maximum upload size. Supports units: `B`, `KB`, `MB`, `GB` |
| `MAX_FILES_PER_UPLOAD` | `32` | Maximum number of files per multi-file upload |

## Expiry Options

| Variable | Default | Description |
| --- | --- | --- |
| `EXPIRE_OPTIONS_SEC` | `300,3600,86400,604800` | Comma-separated list of selectable expiry times in seconds |
| `DEFAULT_EXPIRE_SEC` | `86400` | Default expiry time (must be one of `EXPIRE_OPTIONS_SEC`) |

The default options translate to:
- 5 minutes (`300`)
- 1 hour (`3600`)
- 1 day (`86400`) - default
- 7 days (`604800`)

## Download Limits

| Variable | Default | Description |
| --- | --- | --- |
| `DOWNLOAD_OPTIONS` | `1,2,3,4,5,10,20,50,100` | Comma-separated list of selectable download limits |
| `DEFAULT_DOWNLOAD` | `1` | Default download limit (must be one of `DOWNLOAD_OPTIONS`) |

## Cleanup

| Variable | Default | Description |
| --- | --- | --- |
| `CLEANUP_INTERVAL` | `60` | Interval for the automatic cleanup job in seconds |

## Rate Limiting

| Variable | Default | Description |
| --- | --- | --- |
| `RATE_LIMIT_WINDOW` | `60000` | Rate limit window in milliseconds |
| `RATE_LIMIT_MAX` | `60` | Maximum requests per window per IP |

## Upload Quota

| Variable | Default | Description |
| --- | --- | --- |
| `UPLOAD_QUOTA_BYTES` | `0` | Maximum upload volume per user per window in bytes. `0` disables the quota. |
| `UPLOAD_QUOTA_WINDOW` | `86400` | Quota time window in seconds (default: 24 hours) |

::: info Privacy-Preserving Quotas
Upload quotas use HMAC-SHA256 hashed IPs with a daily rotating key. No plaintext IP addresses are stored. The hash key rotates every 24 hours, making it impossible to correlate users across days.
:::

## Branding

| Variable | Default | Description |
| --- | --- | --- |
| `SITE_TITLE` | `SkySend` | Displayed site title in the UI |

## Validation

SkySend validates all environment variables on startup using Zod:

- `DEFAULT_EXPIRE_SEC` must be one of the values in `EXPIRE_OPTIONS_SEC`
- `DEFAULT_DOWNLOAD` must be one of the values in `DOWNLOAD_OPTIONS`
- `PORT` must be between 1 and 65535
- `MAX_FILE_SIZE` must be a valid byte size string
- `BASE_URL` must be a valid URL (trailing slashes are stripped automatically)

If any variable is invalid, the server will fail to start with a descriptive error message.
