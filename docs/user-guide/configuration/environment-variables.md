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

## File Upload Quota

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `FILE_UPLOAD_QUOTA_BYTES` | ❌ | `0` (unlimited) | Maximum file upload volume per user per window. `0` disables the quota. Supports units: `B`, `KB`, `MB`, `GB`. |
| `FILE_UPLOAD_QUOTA_WINDOW` | ❌ | `86400` | Quota time window in seconds (default: 24 hours). |

::: info Privacy-Preserving Quotas
Upload quotas use HMAC-SHA256 hashed IPs with a daily rotating key. No plaintext IP addresses are stored. The hash key rotates every 24 hours, making it impossible to correlate users across days.
:::

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

## Storage Backend

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `STORAGE_BACKEND` | ❌ | `filesystem` | Storage backend to use. `filesystem` stores files locally, `s3` uses S3-compatible object storage. |
| `S3_BUCKET` | ⚠️ | - | S3 bucket name. Required when `STORAGE_BACKEND=s3`. |
| `S3_REGION` | ⚠️ | - | S3 region (e.g. `eu-central-1`). Required when `STORAGE_BACKEND=s3`. |
| `S3_ENDPOINT` | ❌ | _(none)_ | Custom S3 endpoint URL. Required for non-AWS providers (R2, Hetzner, MinIO, etc.). Leave empty for AWS S3. |
| `S3_ACCESS_KEY` | ⚠️ | - | S3 access key ID. Required when `STORAGE_BACKEND=s3`. |
| `S3_SECRET_KEY` | ⚠️ | - | S3 secret access key. Required when `STORAGE_BACKEND=s3`. |
| `S3_FORCE_PATH_STYLE` | ❌ | `false` | Use path-style URLs instead of virtual-hosted-style. Required for MinIO, Garage, and some self-hosted providers. |
| `S3_PRESIGNED_EXPIRY` | ❌ | `300` | Presigned download URL expiry in seconds. Only used when `S3_PUBLIC_URL` is not set. |
| `S3_PUBLIC_URL` | ❌ | _(none)_ | Public base URL for downloading files (e.g. `https://cdn.example.com`). When set, downloads use direct URLs instead of presigned URLs - simpler and avoids CORS issues. Recommended for R2 custom domains and other publicly accessible buckets. |
| `S3_PART_SIZE` | ❌ | `25MB` | Size of each S3 multipart upload part. Larger values reduce round-trips but use more memory. Minimum is `5MB` (S3 requirement). |
| `S3_CONCURRENCY` | ❌ | `4` | Number of S3 parts uploaded in parallel. Higher values improve throughput but use more memory and bandwidth. Range: 1-16. |

::: info S3-Compatible Providers
SkySend works with any S3-compatible storage provider: AWS S3, Cloudflare R2, Hetzner Object Storage, MinIO, Wasabi, Backblaze B2, DigitalOcean Spaces, Scaleway, and more. Just set the `S3_ENDPOINT` to your provider's endpoint URL.
:::

::: tip Example: Cloudflare R2
```yaml
environment:
  STORAGE_BACKEND: s3
  S3_BUCKET: skysend-uploads
  S3_REGION: auto
  S3_ENDPOINT: "https://<account-id>.r2.cloudflarestorage.com"
  S3_ACCESS_KEY: your-access-key
  S3_SECRET_KEY: your-secret-key
  S3_PUBLIC_URL: "https://cdn.example.com"  # R2 custom domain (recommended)
```
:::

::: tip Example: MinIO (Self-Hosted)
```yaml
environment:
  STORAGE_BACKEND: s3
  S3_BUCKET: skysend-uploads
  S3_REGION: us-east-1
  S3_ENDPOINT: "https://minio.example.com:9000"
  S3_ACCESS_KEY: your-access-key
  S3_SECRET_KEY: your-secret-key
  S3_FORCE_PATH_STYLE: "true"
```
:::

::: warning S3 CORS Configuration
When using S3 storage, your S3 bucket needs a **CORS policy** configured at your provider to allow browser downloads. Without it, downloads will fail with `No 'Access-Control-Allow-Origin' header` errors. The policy must allow `GET` and `HEAD` methods.

**Cloudflare R2:** Go to **R2** > your bucket > **Settings** > **CORS Policy** and add:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://skysend.example.com"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD"
    ]
  }
]
```

**AWS S3:** Go to your bucket > **Permissions** > **CORS configuration**.

**MinIO:** Use `mc admin config set` or the MinIO Console.

Replace `https://your-skysend-domain.com` with your actual SkySend URL. For local development, add `http://localhost:5173`.
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
- When `STORAGE_BACKEND=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` are required
- `S3_ENDPOINT` must be a valid URL when set
- `CUSTOM_COLOR` must be a valid 6-digit hex color code (with or without `#` prefix)
- `CUSTOM_LOGO` must be a URL or an absolute path starting with `/`
- `CUSTOM_PRIVACY` must be a valid URL
- `CUSTOM_LEGAL` must be a valid URL
- `CUSTOM_LINK_URL` must be a valid URL
- `CUSTOM_LINK_NAME` must be at most 50 characters

If any variable is invalid, the server will fail to start with a descriptive error message.
