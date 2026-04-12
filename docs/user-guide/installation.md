# Installation

This guide covers how to install and run SkySend using Docker.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2+ (recommended)

::: tip Multi-Architecture Support
SkySend images are available for **AMD64** (x86_64) and **ARM64** (aarch64) architectures.

Supports: Intel/AMD servers, Raspberry Pi 4+, Apple Silicon (M1/M2/M3), AWS Graviton
:::

## Docker Installation

::: code-group

```yaml [Docker Compose (Recommended)]
# docker-compose.yml
services:
  skysend:
    image: skyfay/skysend:latest
    container_name: skysend
    restart: always
    ports:
      - "3000:3000"
    environment:
      - DATA_DIR=/data
      - UPLOADS_DIR=/uploads
      # - MAX_FILE_SIZE=2GB         # Optional: Max upload size
      # - UPLOAD_QUOTA_BYTES=10GB   # Optional: Per-IP quota per 24h
      # - TRUST_PROXY=true          # Optional: If behind a reverse proxy
      # - PUID=1001                 # Optional: User ID
      # - PGID=1001                 # Optional: Group ID
    volumes:
      - ./data:/data
      - ./uploads:/uploads
```

```bash [Docker Run]
docker run -d \
  --name skysend \
  --restart always \
  -p 3000:3000 \
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
| `/data` | ✅ | Database and persistent data. |
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
  "version": "0.1.0",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

The health check runs every 30 seconds. Docker marks the container as `unhealthy` if 3 consecutive checks fail.

## Next Steps

- [First Steps](/user-guide/first-steps) - Upload your first file
- [Docker Setup](/user-guide/self-hosting/docker) - Advanced Docker configuration
- [Reverse Proxy](/user-guide/self-hosting/reverse-proxy) - Set up Nginx, Caddy, or Traefik
- [Rate Limiting & Quotas](/user-guide/configuration/rate-limiting) - Configure upload quotas
