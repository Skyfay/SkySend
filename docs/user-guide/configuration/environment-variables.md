# Environment Variables

Complete reference of all environment variables supported by SkySend.

## Server

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `PORT` | ❌ | `3000` | Server port (1-65535). |
| `HOST` | ❌ | `0.0.0.0` | Server bind address. |
| `BASE_URL` | ✅ | - | Public URL of the instance (used for CORS and generated links). |
| `DATA_DIR` | ❌ | `./data` | Directory for the database (`DATA_DIR/db/skysend.db`). |
| `UPLOADS_DIR` | ❌ | `{DATA_DIR}/uploads` | Directory for encrypted upload files. In Docker, defaults to `/uploads`. |
| `TRUST_PROXY` | ❌ | `false` | Trust `X-Forwarded-For` and `X-Real-IP` headers. Enable when behind a reverse proxy. |
| `CORS_ORIGINS` | ❌ | _(empty)_ | Additional CORS origins, comma-separated. |

## File Upload Limits

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `FILE_MAX_SIZE` | ❌ | `2GB` | Maximum file upload size. Supports units: `B`, `KB`, `MB`, `GB`. |
| `FILE_MAX_FILES_PER_UPLOAD` | ❌ | `32` | Maximum number of files per multi-file upload. |

## File Expiry Options

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `FILE_EXPIRE_OPTIONS_SEC` | ❌ | `300,3600,86400,604800` | Comma-separated list of selectable expiry times in seconds. |
| `FILE_DEFAULT_EXPIRE_SEC` | ❌ | `86400` | Default expiry time (must be one of `FILE_EXPIRE_OPTIONS_SEC`). |

The default options translate to:
- 5 minutes (`300`)
- 1 hour (`3600`)
- 1 day (`86400`) - default
- 7 days (`604800`)

## File Download Limits

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `FILE_DOWNLOAD_OPTIONS` | ❌ | `1,2,3,4,5,10,20,50,100` | Comma-separated list of selectable download limits. |
| `FILE_DEFAULT_DOWNLOAD` | ❌ | `1` | Default download limit (must be one of `FILE_DOWNLOAD_OPTIONS`). |

## Note Settings

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `NOTE_MAX_SIZE` | ❌ | `1MB` | Maximum note content size. Supports units: `B`, `KB`, `MB`, `GB`. |
| `NOTE_EXPIRE_OPTIONS_SEC` | ❌ | `300,3600,86400,604800` | Comma-separated list of selectable expiry times for notes in seconds. |
| `NOTE_DEFAULT_EXPIRE_SEC` | ❌ | `86400` | Default note expiry time (must be one of `NOTE_EXPIRE_OPTIONS_SEC`). |
| `NOTE_VIEW_OPTIONS` | ❌ | `1,2,3,5,10,20,50,100` | Comma-separated list of selectable view limits for notes. Include `0` for an "Unlimited" option. |
| `NOTE_DEFAULT_VIEWS` | ❌ | `1` | Default view limit for notes (must be one of `NOTE_VIEW_OPTIONS`). `1` means burn-after-reading. `0` means unlimited. |

## Services

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `ENABLED_SERVICES` | ❌ | `file,note` | Comma-separated list of enabled services. Set to `file` for file sharing only, `note` for notes only, or `file,note` for both. Disabled services return HTTP 403 and their UI tabs are hidden. |

## Cleanup

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `CLEANUP_INTERVAL` | ❌ | `60` | Interval for the automatic cleanup job in seconds. |

## Rate Limiting

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `RATE_LIMIT_WINDOW` | ❌ | `60000` | Rate limit window in milliseconds. |
| `RATE_LIMIT_MAX` | ❌ | `60` | Maximum requests per window per IP. |

## File Upload Quota

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `FILE_UPLOAD_QUOTA_BYTES` | ❌ | `0` (unlimited) | Maximum file upload volume per user per window. `0` disables the quota. Supports units: `B`, `KB`, `MB`, `GB`. |
| `FILE_UPLOAD_QUOTA_WINDOW` | ❌ | `86400` | Quota time window in seconds (default: 24 hours). |

::: info Privacy-Preserving Quotas
Upload quotas use HMAC-SHA256 hashed IPs with a daily rotating key. No plaintext IP addresses are stored. The hash key rotates every 24 hours, making it impossible to correlate users across days.
:::

## Branding

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `CUSTOM_TITLE` | ❌ | `SkySend` | Displayed site title in the UI. |
| `CUSTOM_COLOR` | ❌ | _(none)_ | Primary brand color as 6-digit hex code (e.g. `46c89d`). The `#` prefix is optional. |
| `CUSTOM_LOGO` | ❌ | _(none)_ | URL or absolute path to a custom logo (e.g. `https://example.com/logo.svg` or `/custom-logo.svg`). |
| `CUSTOM_PRIVACY` | ❌ | _(none)_ | URL to your privacy policy page. Shown as a link in the footer if set. |
| `CUSTOM_LEGAL` | ❌ | _(none)_ | URL to your legal notice / impressum page. Shown as a link in the footer if set. |
| `CUSTOM_LINK_URL` | ❌ | _(none)_ | URL for a custom footer link. Must be used together with `CUSTOM_LINK_NAME`. |
| `CUSTOM_LINK_NAME` | ❌ | _(none)_ | Display text for the custom footer link (max 50 characters). |

::: tip Example
```yaml
# docker-compose.yml
environment:
  CUSTOM_TITLE: MyShare
  CUSTOM_COLOR: ff6b35
  CUSTOM_LOGO: "https://example.com/my-logo.svg"
  CUSTOM_PRIVACY: "https://example.com/privacy"
  CUSTOM_LEGAL: "https://example.com/impressum"
  CUSTOM_LINK_URL: "https://example.com"
  CUSTOM_LINK_NAME: "My Website"
```

::: tip
The `#` prefix is optional for `CUSTOM_COLOR`. Both `ff6b35` and `#ff6b35` are valid. Omitting the `#` avoids quoting issues in `.env` files.
:::

## Docker

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `PUID` | ❌ | `1001` | User ID the container runs as. |
| `PGID` | ❌ | `1001` | Group ID the container runs as. |
| `SKIP_CHOWN` | ❌ | `false` | Skip `chown` of `/data` and `/uploads` on startup. Required for NFS mounts or read-only filesystems where `chown` is not permitted. You must ensure correct permissions yourself. |

## Validation

SkySend validates all environment variables on startup using Zod:

- `FILE_DEFAULT_EXPIRE_SEC` must be one of the values in `FILE_EXPIRE_OPTIONS_SEC`
- `FILE_DEFAULT_DOWNLOAD` must be one of the values in `FILE_DOWNLOAD_OPTIONS`
- `NOTE_DEFAULT_EXPIRE_SEC` must be one of the values in `NOTE_EXPIRE_OPTIONS_SEC`
- `NOTE_DEFAULT_VIEWS` must be one of the values in `NOTE_VIEW_OPTIONS`
- `ENABLED_SERVICES` must contain at least one of `file` or `note`
- `PORT` must be between 1 and 65535
- `FILE_MAX_SIZE` must be a valid byte size string
- `NOTE_MAX_SIZE` must be a valid byte size string
- `BASE_URL` must be a valid URL (trailing slashes are stripped automatically)
- `CUSTOM_COLOR` must be a valid 6-digit hex color code (with or without `#` prefix)
- `CUSTOM_LOGO` must be a URL or an absolute path starting with `/`
- `CUSTOM_PRIVACY` must be a valid URL
- `CUSTOM_LEGAL` must be a valid URL
- `CUSTOM_LINK_URL` must be a valid URL
- `CUSTOM_LINK_NAME` must be at most 50 characters

If any variable is invalid, the server will fail to start with a descriptive error message.
