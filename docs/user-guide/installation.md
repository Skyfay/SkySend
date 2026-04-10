# Installation

SkySend can be deployed using Docker (recommended) or built from source.

## Docker (Recommended)

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 20.10+
- [Docker Compose](https://docs.docker.com/compose/install/) v2+

### Quick Start

Clone the repository and start SkySend:

```bash
git clone https://github.com/Skyfay/SkySend.git
cd SkySend
docker compose up -d
```

SkySend is now running at [http://localhost:3000](http://localhost:3000).

### Custom Configuration

Create a `.env` file in the project root to override defaults:

```bash
# .env
PORT=3000
MAX_FILE_SIZE=2GB
DEFAULT_EXPIRE_SEC=86400
DEFAULT_DOWNLOAD=1
```

See [Environment Variables](/user-guide/configuration/environment-variables) for all options.

## Build from Source

### Prerequisites

- [Node.js](https://nodejs.org/) 24 LTS or later
- [pnpm](https://pnpm.io/) 9+

### Steps

```bash
# Clone the repository
git clone https://github.com/Skyfay/SkySend.git
cd SkySend

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start the server
node apps/server/dist/index.js
```

The server will start on port 3000 by default and serve the built frontend.

## Verify Installation

After starting SkySend, verify it is running:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

## Next Steps

- [First Steps](/user-guide/first-steps) - Upload your first file
- [Docker Setup](/user-guide/self-hosting/docker) - Detailed Docker configuration
- [Reverse Proxy](/user-guide/self-hosting/reverse-proxy) - Set up Nginx, Caddy, or Traefik
