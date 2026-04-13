# Changelog

All notable changes to SkySend are documented here.

## v2.0.0 - Encrypted Notes, ENV Rename
*Release: In Progress*

> ⚠️ **Breaking:** All file-related environment variables have been renamed with a `FILE_` prefix (e.g. `MAX_FILE_SIZE` -> `FILE_MAX_SIZE`). Old names are no longer supported. See the environment reference for the full mapping.

### ✨ Features
- **server**: Added encrypted notes API with support for text, password, and code content types
- **server**: Added burn-after-reading support for notes via configurable max view count
- **server**: Added new `NOTE_` environment variables for independent note configuration (`NOTE_MAX_SIZE`, `NOTE_EXPIRE_OPTIONS_SEC`, `NOTE_DEFAULT_EXPIRE_SEC`, `NOTE_VIEW_OPTIONS`, `NOTE_DEFAULT_VIEWS`)
- **crypto**: Added `encryptNoteContent` and `decryptNoteContent` for AES-256-GCM note encryption
- **web**: Added tab navigation on upload page (File, Text, Password, Code)
- **web**: Added note creation form with content editor, expiry, view limits, and password protection
- **web**: Added IndexedDB storage for created notes
- **web**: Added note view page with decryption, password prompt, view counter, and burn-after-reading indicator
- **web**: Added note API client functions for fetching note info, viewing content, and password verification
- **web**: Added My Uploads page filter tabs (All, Files, Notes) with combined chronological list
- **web**: Added note cards in My Uploads with view counter, expiry, QR code, copy link, and delete
- **server**: Added `ENABLED_SERVICES` environment variable to enable/disable file and note services independently
- **web**: Upload page and My Uploads page dynamically hide tabs for disabled services
- **server**: Added unlimited views option (`maxViews: 0`) for notes - notes expire only by time, not by view count
- **web**: View selector shows "Unlimited" option when `0` is included in `NOTE_VIEW_OPTIONS`
- **web**: Added translations for Spanish, French, Finnish, Swedish, Norwegian, Dutch, Italian, and Polish
- **web**: Added syntax highlighting with line numbers for code notes (auto-detects 22 languages)
- **web**: Added password generator in the Password tab with configurable length, character types, and entropy display
- **web**: Added SSH Key tab with Ed25519 and RSA-4096 key pair generation, optional passphrase (PKCS#8), and sharing as encrypted note

### 🔄 Changed
- **server**: Renamed all file-related environment variables with `FILE_` prefix for clarity
- **server**: Cleanup job now also removes expired notes and notes that reached their view limit
- **web**: File download URLs changed from `/d/:id` to `/file/:id` with automatic redirect from old URLs

### 🎨 Improvements
- **web**: Replaced default browser scrollbar with custom styled scrollbar on textareas and code blocks
- **web**: Updated footer tagline and browser tab subtitle to reflect file and note sharing

### 📝 Documentation
- **docs**: Updated environment variables reference with new `FILE_` and `NOTE_` variable names
- **docs**: Added v1 to v2 environment variable migration table to environment reference
- **docs**: Updated URL references from `/d/` to `/file/` in architecture and API docs
- **docs**: Added comprehensive API documentation for all 5 note endpoints
- **docs**: Updated API index with note endpoints overview table
- **docs**: Updated user guide with note creation, viewing, and burn-after-reading instructions
- **docs**: Updated README, PHILOSOPHY, and docs landing page branding to reflect file and note sharing

### 🧪 Tests
- **crypto**: Added 9 tests for note content encryption/decryption (round-trip, unicode, tampering, nonce uniqueness)
- **server**: Added 33 tests for note API routes (CRUD, view counting, burn-after-reading, auth tokens, password verification, size/expiry/view validation)
- **server**: Added 4 cleanup tests for note expiry and view limit enforcement
- **server**: Added 7 config tests for `ENABLED_SERVICES` parsing, validation, and cross-field skip logic
- **server**: Added 7 route tests for service guard middleware (403 on disabled services)
- **server**: Added 3 tests for unlimited views (creation, viewing, cleanup skip)

### 🐳 Docker

- **Image**: `ghcr.io/skyfay/skysend:v2.0.0`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v1.0.2 - Patch Release for CORS correction on Health Endpoint
*Released: April 13, 2026*

### 🐛 Bug Fixes
- **server**: Added open CORS policy (`*`) on `/api/health` endpoint so external sites can fetch instance status

### 📝 Documentation
- **docs**: Added website and instances links to README navigation bar

### 🐳 Docker

- **Image**: `ghcr.io/skyfay/skysend:v1.0.2`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.0.1 - Patch Release for Docker Permissions Issue
*Released: April 12, 2026*

### 🐛 Bug Fixes

- **docker**: Replaced recursive `chown` on `/uploads` with a non-recursive, fault-tolerant call to prevent startup failures on NFS mounts and read-only filesystems

### ✨ Features

- **docker**: Added `SKIP_CHOWN` environment variable to skip ownership changes on `/data` and `/uploads` entirely

### 🐳 Docker

- **Image**: `ghcr.io/skyfay/skysend:v1.0.1`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.0.0 - First Stable Release
*Released: April 12, 2026*

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
