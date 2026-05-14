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

## Upload Performance

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `FILE_UPLOAD_CONCURRENT_CHUNKS` | ❌ | `3` | Number of parallel chunk uploads per session (1-20). Increase to improve upload speed in Chromium browsers (Chrome, Edge, Brave) through HTTP/2 reverse proxies. |
| `FILE_UPLOAD_SPEED_LIMIT` | ❌ | `0` (unlimited) | Maximum upload speed per session in bytes per second. `0` disables the limit. Supports units: `B`, `KB`, `MB`, `GB` (e.g. `100MB` for 100 MB/s). |
| `FILE_UPLOAD_WS` | ❌ | `true` | Enable the WebSocket upload transport. Uploads are streamed over a single persistent connection, bypassing HTTP/2 multiplexing bottlenecks in reverse proxies (Traefik, Nginx) and significantly improving upload speed in Chromium browsers. Clients automatically fall back to HTTP chunked uploads when the WebSocket handshake fails. Set to `false` in environments where WebSockets are blocked or terminated. |
| `FILE_UPLOAD_WS_MAX_BUFFER` | ❌ | `16MB` | Maximum bytes the server may buffer per WebSocket upload session before aborting it. Only relevant when the storage backend cannot keep up with the incoming frame rate. Supports units: `B`, `KB`, `MB`, `GB`. Minimum `1MB`. |

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

## Password Lockout

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `PASSWORD_MAX_ATTEMPTS` | ❌ | `10` | Failed password attempts before a specific IP is locked out from a specific upload or note. |
| `PASSWORD_LOCKOUT_MS` | ❌ | `900000` | Lockout duration in milliseconds (default: 15 minutes). |

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
| `S3_PRESIGNED_EXPIRY` | ❌ | `300` | Presigned download URL expiry in seconds. |
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

## Branding & Customization

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `CUSTOM_TITLE` | ❌ | `SkySend` | Displayed site title in the UI. |
| `CUSTOM_COLOR` | ❌ | _(none)_ | Primary brand color as 6-digit hex code (e.g. `46c89d`). The `#` prefix is optional. |
| `CUSTOM_LOGO` | ❌ | _(none)_ | URL or absolute path to a custom logo (e.g. `https://example.com/logo.svg` or `/custom-logo.svg`). |
| `CUSTOM_PRIVACY` | ❌ | _(none)_ | URL to your privacy policy page. Shown as a link in the footer if set. |
| `CUSTOM_LEGAL` | ❌ | _(none)_ | URL to your legal notice / impressum page. Shown as a link in the footer if set. |
| `CUSTOM_LINK_URL` | ❌ | _(none)_ | URL for a custom footer link. Must be used together with `CUSTOM_LINK_NAME`. |
| `CUSTOM_LINK_NAME` | ❌ | _(none)_ | Display text for the custom footer link (max 50 characters). |
| `DEFAULT_THEME` | ❌ | `system` | Default theme for users who have not set a preference. One of `dark`, `light`, or `system`. Users can still override this in the UI. |
| `DEFAULT_TAB` | ❌ | `file` | Default upload tab shown when opening the app. One of `file`, `text`, `password`, `code`, or `sshkey`. Falls back to the first available tab if the configured tab is not enabled via `ENABLED_SERVICES`. |
| `FORCE_FILE_PASSWORD` | ❌ | `false` | When `true`, all file uploads must be password-protected. The password toggle is hidden and the field is always visible. Enforced on both frontend and server. |
| `FORCE_NOTE_PASSWORD` | ❌ | `false` | When `true`, all note uploads (text, password, code, SSH key) must be password-protected. Enforced on both frontend and server. |

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

## SSO / OIDC Authentication

SkySend supports optional single sign-on via any OIDC-compliant provider. When enabled, file uploads and/or note creation require users to authenticate first. Downloads are always public - authentication only gates the upload action.

All OIDC endpoints (authorization, token, userinfo, end-session) are **auto-discovered** from the issuer URL. You never need to specify individual endpoint URLs manually.

### What to register at your provider

When you create a new application/client at your OIDC provider, you only need to configure **one redirect/callback URL**, regardless of whether users access SkySend via the web browser or the CLI client:

```
https://skysend.example.com/auth/callback
```

Replace `skysend.example.com` with your actual domain (the value of `BASE_URL`).

**No additional URLs are needed for the CLI.** The CLI piggybacks on the same server callback - SkySend handles the provider redirect first and then forwards the session token to the CLI's temporary local listener. The provider never talks to the CLI directly.

::: tip Grant type
Register the application as a **confidential client** with the **authorization code** grant type and PKCE support. You need both a client ID and a client secret.
:::

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `OIDC_PROVIDER` | ❌ | `generic` | Provider preset. One of `generic`, `pocketid`, `authentik`, `keycloak`. Controls which token claims are used for the display name. |
| `OIDC_ISSUER` | ⚠️ | - | Issuer URL of your OIDC provider. Required to activate OIDC. All endpoints are discovered automatically from this URL. |
| `OIDC_CLIENT_ID` | ⚠️ | - | Client ID of the application registered at your provider. |
| `OIDC_CLIENT_SECRET` | ⚠️ | - | Client secret of the application registered at your provider. |
| `OIDC_SESSION_SECRET` | ❌ | auto | Secret used to sign session JWT cookies. If not set, a random 48-byte secret is generated at startup - sessions will be invalidated on every server restart. Set this to a fixed value (minimum 32 characters, generate with `openssl rand -base64 48`) to persist sessions across restarts. |
| `OIDC_PROTECT_FILES` | ❌ | `true` | Require login to upload files. Set to `false` to allow anonymous file uploads while OIDC is active. |
| `OIDC_PROTECT_NOTES` | ❌ | `true` | Require login to create notes. Set to `false` to allow anonymous note creation while OIDC is active. |
| `OIDC_REDIRECT_URI` | ❌ | `{BASE_URL}/auth/callback` | Override the OAuth2 redirect/callback URI. Only needed if SkySend is served under a sub-path or behind a proxy that changes the origin. |
| `OIDC_SCOPES` | ❌ | `openid profile email` | Space-separated list of OIDC scopes to request. |
| `OIDC_SESSION_DURATION` | ❌ | `86400` | Session cookie lifetime in seconds (default: 24 hours). |

> ⚠️ The three variables marked ⚠️ (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`) must all be set together. Setting any one of them without the others will cause SkySend to refuse to start.

::: tip Session secret and restarts
If `OIDC_SESSION_SECRET` is not set, SkySend generates a cryptographically random secret at startup. This means every logged-in user will be signed out whenever the server restarts or the container is recreated. If you want sessions to survive restarts, set a fixed value:

```sh
# generate once, then paste the output into your environment
openssl rand -base64 48
```
:::

### Provider: Keycloak

Set `OIDC_ISSUER` to the realm-specific issuer URL. You can find this in the Keycloak Admin Console under **Realm Settings** > **General** > **OpenID Endpoint Configuration** - the `issuer` field is the value to use.

```yaml
environment:
  OIDC_PROVIDER: keycloak
  OIDC_ISSUER: "https://keycloak.example.com/realms/myrealm"
  OIDC_CLIENT_ID: "skysend"
  OIDC_CLIENT_SECRET: "your-client-secret"
```

In Keycloak, create a new client with:
- **Client type**: OpenID Connect
- **Valid redirect URIs**: `https://your-skysend-domain.com/auth/callback`
- **Client authentication**: On (confidential client)

### Provider: PocketID

Set `OIDC_ISSUER` to the root URL of your PocketID instance. PocketID exposes the discovery document at `/.well-known/openid-configuration` on the root, so the issuer URL is simply the base URL.

```yaml
environment:
  OIDC_PROVIDER: pocketid
  OIDC_ISSUER: "https://auth.example.com"
  OIDC_CLIENT_ID: "your-client-id"
  OIDC_CLIENT_SECRET: "your-client-secret"
```

In PocketID, the callback URL to register in the application settings is `https://your-skysend-domain.com/auth/callback`.

### Provider: Authentik

Set `OIDC_ISSUER` to the application-specific path, which includes the application slug. You can find this URL in the Authentik admin panel under **Applications** > your application > **Edit** > **OpenID Configuration Issuer**.

```yaml
environment:
  OIDC_PROVIDER: authentik
  OIDC_ISSUER: "https://auth.example.com/application/o/skysend/"
  OIDC_CLIENT_ID: "your-client-id"
  OIDC_CLIENT_SECRET: "your-client-secret"
```

In Authentik, set the redirect URI in the OAuth2/OIDC provider to `https://your-skysend-domain.com/auth/callback`.

### Provider: Generic

Use `generic` for any other OIDC-compliant provider (Keycloak, Zitadel, Kanidm, Dex, etc.). Set `OIDC_ISSUER` to the issuer URL shown in your provider's OIDC configuration panel or discovery document. The value must match the `issuer` field returned by `/.well-known/openid-configuration`.

```yaml
environment:
  OIDC_PROVIDER: generic
  OIDC_ISSUER: "https://auth.example.com/realms/myrealm"
  OIDC_CLIENT_ID: "your-client-id"
  OIDC_CLIENT_SECRET: "your-client-secret"
```

::: tip What is the Issuer URL?
Open `{OIDC_ISSUER}/.well-known/openid-configuration` in a browser. If you get a JSON document with an `authorization_endpoint` field, the URL is correct. SkySend reads this document automatically at login time.
:::

::: info Partial protection
You can allow anonymous access to one service type while requiring login for the other:

```yaml
# Require login for file uploads, but allow anonymous notes
OIDC_PROTECT_FILES: "true"
OIDC_PROTECT_NOTES: "false"
```
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
- When any OIDC variable is set, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` must all be present
- If `OIDC_SESSION_SECRET` is set, it must be at least 32 characters
- `OIDC_ISSUER` and `OIDC_REDIRECT_URI` must be valid URLs when set

If any variable is invalid, the server will fail to start with a descriptive error message.
