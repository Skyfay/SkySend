# Upload Limits

SkySend provides several configuration options to control upload behavior.

## Maximum File Size

The `FILE_MAX_SIZE` variable controls the maximum allowed upload size. It supports human-readable units:

```bash
FILE_MAX_SIZE=2GB      # 2 gigabytes (default)
FILE_MAX_SIZE=500MB    # 500 megabytes
FILE_MAX_SIZE=100MB    # 100 megabytes
```

Supported units: `B`, `KB`, `MB`, `GB`

::: tip Reverse Proxy
If using a reverse proxy (Nginx, Caddy, etc.), make sure its upload size limit matches. For Nginx, set `client_max_body_size`.
:::

## Maximum Files Per Upload

When users upload multiple files, they are zipped client-side before encryption. The `FILE_MAX_FILES_PER_UPLOAD` variable limits the number of files per upload:

```bash
FILE_MAX_FILES_PER_UPLOAD=32   # default
FILE_MAX_FILES_PER_UPLOAD=100  # allow more files
```

Note: `FILE_MAX_SIZE` applies to the total payload size (after zip, before encryption), not to individual files.

## Expiry Options

Control which expiry times users can select:

```bash
# Default: 5min, 1h, 1d, 7d
FILE_EXPIRE_OPTIONS_SEC=300,3600,86400,604800

# Custom: 1h, 12h, 1d, 3d
FILE_EXPIRE_OPTIONS_SEC=3600,43200,86400,259200

# Short-lived only: 5min, 15min, 1h
FILE_EXPIRE_OPTIONS_SEC=300,900,3600
```

The `FILE_DEFAULT_EXPIRE_SEC` must be one of the values in `FILE_EXPIRE_OPTIONS_SEC`.

## Download Limits

Control which download limits users can select:

```bash
# Default options
FILE_DOWNLOAD_OPTIONS=1,2,3,4,5,10,20,50,100

# Restrictive: 1-5 only
FILE_DOWNLOAD_OPTIONS=1,2,3,4,5

# Generous: allow up to 1000
FILE_DOWNLOAD_OPTIONS=1,5,10,50,100,500,1000
```

The `FILE_DEFAULT_DOWNLOAD` must be one of the values in `FILE_DOWNLOAD_OPTIONS`.

## How Limits Are Enforced

1. The frontend fetches server limits via `GET /api/config` on load
2. Upload options in the UI are restricted to server-configured values
3. The server validates all headers against configured limits during upload
4. Uploads exceeding `FILE_MAX_SIZE` are rejected before writing to disk
5. `Content-Length` header must match the actual body size
