# Upload Limits

SkySend provides several configuration options to control upload behavior. All variables are documented in the [Environment Variables](/user-guide/configuration/environment-variables) reference.

## Maximum File Size

`FILE_MAX_SIZE` controls the maximum allowed upload size (default: `2GB`). Supports units: `B`, `KB`, `MB`, `GB`.

::: tip Reverse Proxy
If using a reverse proxy (Nginx, Caddy, etc.), make sure its upload size limit matches or exceeds `FILE_MAX_SIZE`. For Nginx, set `client_max_body_size`.
:::

## Maximum Files Per Upload

`FILE_MAX_FILES_PER_UPLOAD` limits the number of files per upload (default: `32`). When users upload multiple files, they are zipped client-side before encryption. `FILE_MAX_SIZE` applies to the total payload size after zipping, not to individual files.

## Expiry Options

`FILE_EXPIRE_OPTIONS_SEC` controls which expiry times users can select, as a comma-separated list of seconds (default: `300,3600,86400,604800`). `FILE_DEFAULT_EXPIRE_SEC` sets the pre-selected default and must be one of those values.

## Download Limits

`FILE_DOWNLOAD_OPTIONS` controls which download limits users can select (default: `1,2,3,4,5,10,20,50,100`). `FILE_DEFAULT_DOWNLOAD` sets the pre-selected default and must be one of those values.

## How Limits Are Enforced

1. The frontend fetches server limits via `GET /api/config` on load
2. Upload options in the UI are restricted to server-configured values
3. The server validates all headers against configured limits during upload
4. Uploads exceeding `FILE_MAX_SIZE` are rejected before writing to disk
5. `Content-Length` header must match the actual body size
