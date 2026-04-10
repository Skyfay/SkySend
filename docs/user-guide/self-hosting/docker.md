# Docker Setup

This guide covers the Docker deployment of SkySend in detail.

## Docker Compose (Recommended)

The simplest way to run SkySend is with Docker Compose:

```yaml
services:
  skysend:
    build: .
    restart: always
    ports:
      - "${PORT:-3000}:3000"
    volumes:
      - "${DATA_DIR:-./data}:/app/data"
    env_file:
      - .env
    environment:
      - DATA_DIR=/app/data
```

Start with:

```bash
docker compose up -d
```

## Environment Variables

Pass environment variables via `.env` file or directly:

```bash
# .env
PORT=3000
MAX_FILE_SIZE=2GB
DEFAULT_EXPIRE_SEC=86400
UPLOAD_QUOTA_BYTES=10737418240  # 10 GB per user per day
```

See [Environment Variables](/user-guide/configuration/environment-variables) for the complete reference.

## Data Persistence

SkySend stores all data in a single directory (default: `./data`):

```
data/
  skysend.db        # SQLite database
  uploads/          # Encrypted upload files
```

::: warning Backups
To back up SkySend, simply copy the entire `data/` directory. The SQLite database uses WAL mode, so it is safe to copy while the server is running.
:::

## Building the Image

SkySend uses a multi-stage Dockerfile:

1. **base** - Node.js 24 Alpine with pnpm
2. **build** - Installs all dependencies and builds the project
3. **deploy** - Production image with only runtime dependencies

```bash
docker build -t skysend .
```

The final image contains:
- Built server (`apps/server/dist`)
- Built frontend (`apps/web/dist`)
- Production dependencies only

## Custom Port

To run on a different port:

```bash
PORT=8080 docker compose up -d
```

Or in your `.env`:

```bash
PORT=8080
```

## Updating

To update to a new version:

```bash
git pull
docker compose build
docker compose up -d
```

Your data is preserved in the mounted volume.
