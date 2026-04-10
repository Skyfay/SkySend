# SkySend

**Minimalist, end-to-end encrypted, self-hostable file sharing service.**

Inspired by [timvisee/send](https://github.com/timvisee/send) (the community fork of Mozilla Send), SkySend aims to be a modern alternative built from scratch with higher security standards and a minimal, maintainable codebase.

SkySend encrypts files completely in the browser before they reach the server. The server never sees the plaintext data at any time. No accounts, no telemetry, no external dependencies.

## Features

- **End-to-End Encryption** - AES-256-GCM, the server does not know the key
- **No User Accounts** - Just upload a file and share the link
- **Password Protection** - Links can be optionally protected with a password (Argon2id)
- **Automatic Expiry** - Links expire after a configurable time or number of downloads
- **Self-Hosted** - A single Docker container, your data stays with you
- **Zero Knowledge** - The server stores only encrypted blobs

## Quick Start

```bash
docker compose up -d
```

Then visit in your browser: `http://localhost:3000`

## Configuration

Copy `.env.example` to `.env` and adjust the values:

```bash
cp .env.example .env
```

See [Documentation](docs/) for all configuration options.

## Admin CLI

```bash
# Show active uploads
docker exec skysend skysend-cli list

# Manually delete an upload
docker exec skysend skysend-cli delete <id>

# Storage overview
docker exec skysend skysend-cli stats

# Cleanup expired uploads
docker exec skysend skysend-cli cleanup
```

## Development

```bash
# Requirements: Node.js 24+, pnpm 9+
pnpm install
pnpm dev
```

## Tech Stack

| Area     | Technology                |
| -------- | ------------------------- |
| Frontend | Vite + React + Shadcn UI  |
| Backend  | Hono (Node.js)            |
| Database | SQLite (Drizzle ORM)      |
| Crypto   | Web Crypto API + Argon2id |
| Build    | Vite                      |
| Docs     | VitePress                 |

## Security

The complete crypto design is publicly described in the [Documentation](docs/security/encryption.md). All crypto code is Open Source and auditable.

Please report security vulnerabilities responsibly - see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPLv3](LICENSE) - Any hosted instance must release its source code.
