# Changelog

All notable changes to SkySend are documented here.

## v0.1.0 - Initial Release
*Release: In Progress*

### Features

- **Crypto Library** (`@skysend/crypto`)
  - AES-256-GCM streaming encryption/decryption (64KB record size)
  - HKDF-SHA256 key derivation with domain-separated keys (fileKey, metaKey, authKey)
  - Metadata encryption with random IV
  - Password protection via Argon2id (WASM) with PBKDF2-SHA256 fallback
  - Base64url encoding, constant-time comparison, and utility functions
  - Full unit and integration test suite

- **Backend** (`apps/server`)
  - Hono-based REST API with streaming upload/download
  - SQLite database with Drizzle ORM and WAL mode
  - Filesystem storage layer with path traversal protection
  - Auth middleware with constant-time token comparison
  - Rate limiting (sliding window, per-IP)
  - Upload quota with HMAC-hashed IPs and daily key rotation
  - Automatic cleanup job for expired uploads
  - Static SPA serving from Vite build output
  - Graceful shutdown with 10-second timeout

- **Frontend** (`apps/web`)
  - React 19 SPA with Vite and Shadcn UI
  - Drag & drop upload zone (files and folders)
  - Multi-file upload with client-side zip (fflate)
  - Configurable expiry time and download limits
  - Optional password protection
  - Upload progress indicator
  - Share link with copy button
  - Upload management dashboard (IndexedDB-based, no account required)
  - Download page with password prompt and progress
  - Dark mode with automatic detection
  - Internationalization (English, German) with auto-detection
  - Responsive design (mobile + desktop)

- **Admin CLI** (`apps/cli`)
  - `list` - Show active uploads
  - `delete` - Delete upload by ID
  - `stats` - Storage overview
  - `cleanup` - Remove expired uploads
  - `config` - Show server configuration

- **Infrastructure**
  - Multi-stage Dockerfile (Node 24 Alpine)
  - Docker Compose with volume persistence
  - pnpm monorepo with workspaces
  - ESLint + Prettier configuration
  - TypeScript strict mode
  - Vitest test suite

### 🐳 Docker

- **Image**: `skyfay/skysend:v0.1.0`
- **Also tagged as**: `latest`, `v0`
- **Platforms**: linux/amd64, linux/arm64
