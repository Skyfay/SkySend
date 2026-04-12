# Changelog

All notable changes to SkySend are documented here.

## v1.0.0 - First Stable Release
*Release: In Progress*

This is the first stable release of SkySend, marking the completion of the initial development phase and the beginning of production use. The v1.0.0 release includes all core features, security measures, and documentation necessary for self-hosting and public deployment.

### ✨ Features

- **crypto**: AES-256-GCM streaming encryption and decryption with 64KB record size
- **crypto**: HKDF-SHA256 key derivation with domain-separated keys (fileKey, metaKey, authKey)
- **crypto**: Metadata encryption with random IV for filenames, MIME types, and file lists
- **crypto**: Password protection via Argon2id (WASM) with PBKDF2-SHA256 fallback
- **crypto**: Base64url encoding, constant-time comparison, and utility functions
- **server**: Hono-based REST API with streaming upload and download
- **server**: Chunked upload flow with init, stream, and finalize endpoints
- **server**: SQLite database with Drizzle ORM and WAL mode
- **server**: Filesystem storage layer with path traversal protection
- **server**: Auth middleware with constant-time token comparison
- **server**: Sliding-window rate limiting per IP with `X-RateLimit-*` response headers
- **server**: Upload quota with HMAC-SHA256 hashed IPs and daily rotating keys for privacy
- **server**: Quota status endpoint (`GET /api/quota`) with remaining bytes and reset time
- **server**: Health check endpoint (`GET /api/health`) with version and timestamp
- **server**: Automatic cleanup job for expired uploads on startup and at configurable intervals
- **server**: Static SPA serving from Vite build output
- **server**: Graceful shutdown with 10-second timeout
- **server**: Configurable branding via environment variables (title, color, logo, footer links)
- **web**: React 19 SPA with Vite, Tailwind CSS, and shadcn/ui components
- **web**: Drag-and-drop upload zone supporting files and folders
- **web**: Multi-file upload with client-side zip compression (fflate)
- **web**: Three-tier download strategy - Service Worker streaming, File System Access API, and in-memory blob fallback
- **web**: OPFS-backed decryption pipeline via Web Worker for zero-RAM streaming downloads
- **web**: Safari warning for large file downloads exceeding 256 MB
- **web**: Configurable expiry time and download limits per upload
- **web**: Optional password protection with show/hide toggle
- **web**: Upload progress with phase indicator, percentage, and speed display
- **web**: Favicon progress circle during active uploads
- **web**: Share link page with one-click copy
- **web**: Upload history dashboard backed by IndexedDB - no account required
- **web**: Download page with metadata decryption, password prompt, and progress
- **web**: Quota bar with visual progress indicator
- **web**: Skeleton loading states for all pages
- **web**: Version number displayed in footer from package.json
- **web**: Dark mode with automatic system preference detection
- **web**: Internationalization (English, German) with browser language auto-detection
- **web**: Responsive design for mobile and desktop
- **web**: Toast notification system for success, error, and warning messages
- **cli**: `list` command to show active uploads
- **cli**: `delete` command to remove an upload by ID
- **cli**: `stats` command for storage overview
- **cli**: `cleanup` command to remove expired uploads
- **cli**: `config` command to display server configuration
- **docs**: Full documentation site with VitePress
- **docs**: Developer guide covering architecture, API reference, crypto internals, and download modes
- **docs**: User guide with installation, configuration, security, and self-hosting sections
- **infra**: Multi-stage Dockerfile based on Node 24 Alpine
- **infra**: Docker Compose with volume persistence and health checks
- **infra**: pnpm monorepo with workspaces
- **infra**: ESLint and Prettier configuration
- **infra**: TypeScript strict mode across all packages
- **infra**: Vitest test suite with unit and integration tests

### 🐳 Docker

- **Image**: `skyfay/skysend:v1.0.0`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64
