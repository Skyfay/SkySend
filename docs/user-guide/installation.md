# Installation

This guide covers how to install and run SkySend using Docker, and how to install the CLI client for terminal usage.

## Server (Docker)

### Prerequisites

- Docker Engine 20.10+
- Docker Compose v2+ (recommended)

::: tip Multi-Architecture Support
SkySend images are available for **AMD64** (x86_64) and **ARM64** (aarch64) architectures.

Supports: Intel/AMD servers, Raspberry Pi 4+, Apple Silicon (M1/M2/M3), AWS Graviton
:::

### System Requirements

| Tier | CPU | RAM | Uploads in total | Downloads in total |
| :--- | :--- | :--- | :--- | :--- |
| Minimal | 1 core | 1 GB | 120 to 180 MiB/s | 340 to 500 MiB/s |
| Recommended | 2 cores | 2 GB | 230 to 270 MiB/s, limit of the test | 600 to 900 MiB/s, limit of the test |
| Enterprise | 4 cores | 4 to 8 GB | 260 to 290 MiB/s, limit of the test | 600 to 1000 MiB/s, limit of the test |

Disk: room for the uploads, or only the database with [S3 storage](/user-guide/configuration/s3).

How many transfers at once make sense follows from these totals and the speed each one should get. At 10 MiB/s per transfer, about a line of 100 Mbit/s, a Minimal server carries 12 to 18 uploads or 30 to 50 downloads at full speed, a Recommended one at least 23 uploads or 60 downloads. More at once still work, each one gets a smaller share. Every tier was tested with 32 transfers at once without an error. An upload holds up to about 20 MB of memory while it runs, a download about 2 MB. The server sizes those buffers from the memory it may use, the limit of its container if it runs in one.

More cores and memory let more transfers run at once at full speed, up to what one instance carries. Its JavaScript runs on one thread, so beyond about four cores more hardware adds headroom for peaks and for other services on the same machine rather than more transfers. Memory alone does not cap the number of transfers: when the buffers are full, uploads share them and slow down instead of failing.

- Measured on x86_64 with the server limited like `docker run --cpus --memory`, filesystem storage and Chromium on the same machine, files of 128 and 256 MiB, up to 32 at once.
- From two cores on, the browsers of the test were the limit, not the server, so Recommended and Enterprise carry more than the table says.
- Uploads to S3 reached about the same totals, 183 MiB/s with one core. A download from S3 goes from the bucket straight to the browser and costs the server nothing.
- With one core, and in some runs with two, downloads got a small share while uploads were running.
- ARM boards can be slower per core, and the link of the server is often the real limit: 1 Gbit/s is about 118 MiB/s.

## Docker Installation

::: code-group

```yaml [Docker Compose]
services:
  skysend:
    image: skyfay/skysend:latest
    container_name: skysend
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
      - ./uploads:/uploads
    environment:
      - BASE_URL=http://localhost:3000
      # All environment variables: https://docs.skysend.app/user-guide/configuration/environment-variables
      # There are a lot of customization options available, so make sure to check the documentation for more details.
```

```bash [Docker Run]
docker run -d \
  --name skysend \
  --restart always \
  -p 3000:3000 \
  -e BASE_URL=http://localhost:3000 \
  -e DATA_DIR=/data \
  -e UPLOADS_DIR=/uploads \
  -v "$(pwd)/data:/data" \
  -v "$(pwd)/uploads:/uploads" \
  skyfay/skysend:latest
```

:::

### Start & Access

```bash
docker compose up -d
```

SkySend is now running at [http://localhost:3000](http://localhost:3000).

## Environment Variables

All environment variables are optional. SkySend works out of the box with sensible defaults.

→ See the full **[Environment Variables](/user-guide/configuration/environment-variables)** reference for all options, default values and descriptions.

## Volume Mounts

| Mount Point | Required | Purpose |
| :--- | :---: | :--- |
| `/data` | ✅ | Database and persistent data. Also holds `/data/branding` for your own logo. |
| `/uploads` | ✅ | Encrypted file storage. |

::: warning Data Persistence
Always mount both `/data` and `/uploads` to host directories. Without volumes, all uploads and database state are lost when the container is recreated.
:::

## Health Check

SkySend includes a built-in Docker health check:

```bash
curl http://localhost:3000/api/health
```

Response:
```json
{
  "status": "ok",
  "version": "2.11.3",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

The health check runs every 30 seconds. Docker marks the container as `unhealthy` if 3 consecutive checks fail.

## CLI Client

The SkySend CLI client lets you upload and download files from the terminal with the same end-to-end encryption as the web interface. It is a standalone binary with no runtime dependencies.

### Linux / macOS

```bash
curl -fsSL https://skysend.app/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://skysend.app/install.ps1 | iex
```

### Verify Installation

```bash
skysend --version
skysend --help
```

See the full [CLI Client documentation](/user-guide/client-cli/) for setup, configuration, and all available commands.

## Next Steps

- [First Steps](/user-guide/first-steps) - Upload your first file
- [Docker Setup](/user-guide/self-hosting/docker) - Advanced Docker configuration
- [Reverse Proxy](/user-guide/self-hosting/reverse-proxy) - Set up Nginx, Caddy, or Traefik
- [Rate Limiting & Quotas](/user-guide/configuration/rate-limiting) - Configure upload quotas
