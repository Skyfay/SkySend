# Changelog

All notable changes to SkySend are documented here.

## v2.2.1 - Parallel Chunk Uploads and Performance Improvements
*Released: April 15, 2026*

### 🎨 Improvements
- **web**: Upload chunks are now sent in parallel (up to 3 concurrent, 10 MB each) instead of sequentially (50 MB each), dramatically improving upload speed in Chrome, Brave, and Edge through reverse proxies like Traefik
- **server**: Chunk upload endpoint accepts an `index` query parameter and reassembles chunks in-order on the server, ensuring data integrity with parallel client uploads
- **server**: In-order chunks are now streamed directly to storage without buffering, eliminating unnecessary memory copies on the hot path
- **server**: Optimized S3 multipart upload buffering to avoid full-buffer reallocation on every chunk append
- **server**: S3 part uploads now run as a concurrent pool with smooth backpressure - waits for one upload slot to free up instead of draining everything, giving consistent throughput instead of burst-stop cycles

### 🐳 Docker

- **Image**: `ghcr.io/skyfay/skysend:v2.2.1`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.2.0 - S3 Storage Backend
*Released: April 15, 2026*

### ✨ Features
- **server**: Added S3-compatible storage backend as alternative to local filesystem storage
- **server**: Added `STORAGE_BACKEND` environment variable to switch between `filesystem` (default) and `s3` storage
- **server**: Added S3 configuration via environment variables (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PRESIGNED_EXPIRY`, `S3_PUBLIC_URL`)
- **server**: Uploads in S3 mode stream directly to S3 via multipart upload without disk buffering on the server
- **server**: Added `S3_PUBLIC_URL` for direct download URLs via R2 custom domains or public buckets - avoids presigned URL complexity and CORS issues
- **server**: Falls back to presigned URLs when `S3_PUBLIC_URL` is not set (for private buckets)
- **web**: Client download logic transparently handles both direct file streams (filesystem), presigned URL redirects (S3 private), and public URL redirects (S3 public)
- **server**: Supports all S3-compatible providers (AWS S3, Cloudflare R2, Hetzner Object Storage, MinIO, Wasabi, Backblaze B2, DigitalOcean Spaces, and more) via custom endpoint configuration
- **server**: Logs storage mode on startup (filesystem path or S3 endpoint with public/presigned mode)
- **server**: S3 connectivity test on startup - verifies bucket access, write, and delete permissions before accepting requests
- **server**: Added `S3_PART_SIZE` and `S3_CONCURRENCY` environment variables for tuning S3 upload throughput
- **web**: Download progress bar now shows real-time download speed (e.g. `42.5 MB/s`) alongside the percentage, matching the upload speed display

### 🐛 Bug Fixes
- **docker**: Fixed Docker healthcheck showing `unhealthy` despite a running server - replaced `wget` (not available in Alpine) with Node.js `fetch` and increased start period to 30s
- **web**: Upload progress bar now reflects actual end-to-end upload progress instead of encryption speed - progress updates after each chunk is fully uploaded (including server-to-S3 forwarding)

### 🔒 Security
- **server**: CSP `connect-src` header is dynamically extended to allow client fetches to the configured S3 endpoint

### 🎨 Improvements
- **server**: Introduced `StorageBackend` interface with adapter pattern for pluggable storage implementations
- **server**: Optimized S3 multipart upload performance - configurable part size (default 25MB) and parallel part uploads (default 4 concurrent) to reduce round-trip overhead

### 📝 Documentation
- **docs**: Added S3 storage backend section to environment variables reference with configuration table, `S3_PUBLIC_URL`, and provider examples (R2, MinIO)
- **docs**: Added S3 variable definitions to developer environment reference (`STORAGE_BACKEND`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PRESIGNED_EXPIRY`, `S3_PUBLIC_URL`, `S3_PART_SIZE`, `S3_CONCURRENCY`)
- **docs**: Updated architecture diagram and data storage section to reflect S3 backend and download flow
- **docs**: Added S3 CORS configuration guide with examples for Cloudflare R2, AWS S3, and MinIO
- **docs**: Added S3 Docker Compose example with `S3_PUBLIC_URL` to self-hosting guide
- **docs**: Updated data backups guide with S3 storage note
- **docs**: Added S3 storage mention to README and docs homepage feature cards

### 🐳 Docker

- **Image**: `ghcr.io/skyfay/skysend:v2.2.0`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.1.0 - General UI and Documentation Improvements
*Released: April 14, 2026*

### ✨ Features
- **docs**: Added VitePress sitemap generation (`/sitemap.xml`) for Google Search Console indexing
- **docs**: Added Cloudflare Worker that fetches instance data (version, config, enabled services) hourly and caches it in KV
- **docs**: Instances page now loads all data from a single cached API endpoint instead of querying each instance individually
- **docs**: Instance limits (max file size, quota, expiry, downloads) are now fetched dynamically from each instance's `/api/config` endpoint
- **docs**: Added service filter (All / Files / Notes) to instances page based on each instance's `enabledServices` configuration
- **docs**: Added skeleton loading animation while instance data is being fetched
- **docs**: Instance list is now maintained via `docs/public/instances.json` - users can add instances via pull request
- **docs**: Instance cards show separate Files and Notes stats sections, each only visible when the service is enabled
- **docs**: Instance cards show "Official" or "Community" badge, with official instances (skysend.ch) always sorted first
- **web**: Added language switcher dropdown in the navbar with country flag icons via `flag-icons` library
- **web**: Manual language selection is persisted in a cookie so it survives page reloads and sessions
- **web**: Added optional custom labels for password notes so users can describe what each password is for

### 🎨 Improvements
- **web**: Redesigned theme toggle from a cycling button to a dropdown menu with Auto, Light, and Dark options
- **web**: Fixed an UI issue on text and markdown note cards, when they were expanded

### 🐳 Docker

- **Image**: `ghcr.io/skyfay/skysend:v2.1.0`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.0.0 - Encrypted Notes, Text, Passwords, Code Snippets, and SSH Keys
*Released: April 13, 2026*

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
- **web**: Added My Uploads page filter tabs (All, Files, Text, Passwords, Code, Markdown, SSH Keys) with combined chronological list
- **web**: Added note cards in My Uploads with view counter, expiry, QR code, copy link, and delete
- **server**: Added `ENABLED_SERVICES` environment variable to enable/disable file and note services independently
- **web**: Upload page and My Uploads page dynamically hide tabs for disabled services
- **server**: Added unlimited views option (`maxViews: 0`) for notes - notes expire only by time, not by view count
- **web**: View selector shows "Unlimited" option when `0` is included in `NOTE_VIEW_OPTIONS`
- **web**: Added translations for Spanish, French, Finnish, Swedish, Norwegian, Dutch, Italian, and Polish
- **web**: Added syntax highlighting with line numbers for code notes (auto-detects 22 languages)
- **web**: Added password generator in the Password tab with configurable length, character types, and entropy display
- **web**: Added SSH Key tab with Generate/Paste modes, Ed25519 and RSA (1024/2048/4096) key pair generation, optional passphrase (PKCS#8), and sharing as encrypted note
- **web**: Added Markdown mode in Text tab with Plain Text/Markdown sub-toggle, live preview, and rendered Markdown display on note view (GFM support via react-markdown)
- **crypto**: Added `sshkey` as dedicated `NoteContentType` so SSH key notes display with their own icon and label in My Uploads
- **web**: Redesigned Password tab with single-line input fields, per-field password generator toggle, and add/remove support for multiple passwords
- **web**: Password note viewer now shows each password individually with separate reveal and copy buttons
- **cli**: Added notes support to `list`, `delete`, `stats`, and `cleanup` commands

### 🔄 Changed
- **server**: Renamed all file-related environment variables with `FILE_` prefix for clarity
- **server**: Cleanup job now also removes expired notes and notes that reached their view limit
- **web**: File download URLs changed from `/d/:id` to `/file/:id` with automatic redirect from old URLs

### 🎨 Improvements
- **web**: Replaced default browser scrollbar with custom styled scrollbar on textareas and code blocks
- **web**: Updated footer tagline and browser tab subtitle to reflect file and note sharing
- **web**: Removed primary-color border from ShareLink card and NoteView card to avoid confusion with custom color themes
- **web**: Added `success` Tailwind color variable (fixed SkySend green) for the "Upload complete" text so it stays green regardless of custom primary color

### 📝 Documentation
- **docs**: Updated environment variables reference with new `FILE_` and `NOTE_` variable names
- **docs**: Added v1 to v2 environment variable migration table to environment reference
- **docs**: Updated URL references from `/d/` to `/file/` in architecture and API docs
- **docs**: Added comprehensive API documentation for all 5 note endpoints
- **docs**: Updated API index with note endpoints overview table
- **docs**: Updated user guide with note creation, viewing, and burn-after-reading instructions
- **docs**: Updated README, PHILOSOPHY, and docs landing page branding to reflect file and note sharing
- **docs**: Added screenshots page with overview, note types, and My Uploads views

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
