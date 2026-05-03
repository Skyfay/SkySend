# Changelog

All notable changes to SkySend are documented here.

## v2.5.7 - Docker Entrypoint Custom Data/Uploads Directory Fix
*Released: May 3, 2026*

### 🐛 Bug Fixes

- **docker**: Fixed `EACCES: permission denied` on startup when `DATA_DIR` or `UPLOADS_DIR` are set to a custom path - the entrypoint previously hardcoded `/data` and `/uploads` for `mkdir` and `chown`, so custom paths were never created or made writable. The entrypoint now uses the actual `DATA_DIR` and `UPLOADS_DIR` environment variables.

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.5.7`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.5.6 - Docker Entrypoint PGID Fix
*Released: May 3, 2026*

### 🐛 Bug Fixes

- **docker**: Fixed container startup failing with `addgroup: group 'skysend' in use` when `PGID` is set to a value other than the default `1001` - `busybox`'s `delgroup` cannot remove a group that still has members, so the subsequent `addgroup` always failed. The entrypoint now uses `sed` to update the GID in-place in `/etc/group` and `/etc/passwd`, matching the existing approach used for `PUID`.

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.5.6`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.5.5 - CSP Fix for Password-Protected Uploads, Downloads and Notes
*Released: May 2, 2026*

### 🐛 Bug Fixes

- **server**: Fixed password-protected file and note uploads/downloads failing with `WebAssembly.compile() blocked by CSP` in browsers behind reverse proxies that forward CSP headers - added `'wasm-unsafe-eval'` to `script-src` to allow Argon2id (hash-wasm) to compile its inline WASM binary.

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.5.5`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.5.4 - Content Security Policy Update for Custom Logo Support
*Released: May 1, 2026*

### 🔄 Changed

- **server**: Content Security Policy now dynamically allows the origin of `CUSTOM_LOGO` in `img-src` when an external HTTP(S) logo URL is configured, while keeping the default image policy strict.

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.5.4`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.5.3 - WebSocket Upload Keepalive
*Released: April 25, 2026*

### 🐛 Bug Fixes

- **server**: Fixed WebSocket uploads hanging at 100% on remote servers behind a reverse proxy - the server now sends a keepalive message every 5 seconds during the finalization phase so Caddy/Nginx/Traefik do not close the connection as idle while the server is still flushing data to storage and writing to the DB.

### 🔧 CI/CD

- **infra**: Added branche ignore rule to stop branch-specific workflows (e.g. `release.yml`) from running on the `main` branch - these workflows are only meant to run on feature branches and tags, not on `main` where they cause noise and duplicate runs alongside the generic `validate.yml`.

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.5.3`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.5.2 - Client Improvements & Bug fixes
*Released: April 25, 2026*

### 🐛 Bug Fixes

- **client**: Fixed `resolveServer()` ignoring `defaultServer` and using the legacy top-level `server` field instead - if both fields exist in `config.json` (e.g. after migrating to multi-server), the TUI and all commands now correctly prefer `defaultServer`.
- **client**: Fixed WebSocket uploads hanging at 100% on remote servers - the progress bar reached 100% as soon as data was queued in Node.js's send buffer, not when it arrived at the server, causing the fixed 5-minute finalize timeout to expire for large files on slow connections. The send buffer is now drained to zero before sending "finalize", the timeout is dynamic (5 min + 2 s/MB), and the TUI/CLI show "Finalizing..." while waiting for the server confirmation.

### 🎨 Improvements

- **client**: TUI and non-interactive CLI now display the average upload speed on the summary screen after a successful upload, matching the existing web behavior.

### 📝 Documentation

- **docs**: Updated the benchmarks page with more specific details on the environment, new results and client tests.

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.5.2`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.5.1 - Bug fixes, dependency updates, and Dockerfile improvements
*Released: April 25, 2026*

### 🐛 Bug Fixes

- **client**: Fixed `skysend update` failing on Windows with "Permission denied" even as Administrator. Windows locks running `.exe` files, so `fs.renameSync` always threw `EPERM`. The fix spawns a detached, hidden `cmd.exe` batch script that waits 2 seconds (until the current process exits) then moves the downloaded binary into place with `move /y`.
- **client**: Fixed `install.ps1` hanging silently during download. PowerShell's default `$ProgressPreference = 'Continue'` makes `Invoke-WebRequest` up to 100x slower and shows no feedback in many terminal environments. The script now sets `$ProgressPreference = 'SilentlyContinue'` and prints `Downloading <file>... done (X.X MB)` and `Verifying checksum... ok` step messages instead.
- **client**: Fixed `install.sh` showing no output during binary download. `curl -fsSL` and `wget -q` were fully silent. The binary download now uses `curl --progress-bar` (shows a `#####` bar on stderr) and `wget` without `-q`, so users see download progress.
- **server**: Fixed S3 uploads failing with Cloudflare R2 and other S3-compatible providers with the error `[EntityReplacer] Invalid character '#' in entity name: "#xD"`. The root cause was `fast-xml-parser@5.7.1` introducing a regression where numeric character references (e.g. `&#xD;`) in XML responses could no longer be parsed. Updated `fast-xml-parser` override to `>=5.7.2` which restores correct behavior.
- **server**: Set `requestChecksumCalculation` and `responseChecksumValidation` to `WHEN_REQUIRED` on the S3 client. AWS SDK v3 >=3.679 defaults to `WHEN_SUPPORTED`, causing proactive CRC checksum headers that can trigger provider-specific XML parsing issues.

### 🔒 Security

- **infra**: Added `pnpm.overrides` for `postcss` (`>=8.5.10`) to patch a moderate XSS vulnerability (GHSA-qx2v-qp2m-jg93) in transitive dependencies via `autoprefixer`

### 🎨 Improvements

- **server**: Updated `@hono/node-server` from v1 to v2 - same public API, up to 2.3x faster body parsing via optimized direct Node.js `IncomingMessage` reads, URL construction fast-path, and `buildOutgoingHttpHeaders` optimization
- **infra**: Updated patch and minor dependencies across all workspace packages - `hono`, `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`, `better-sqlite3`, `tailwindcss`, `@tailwindcss/vite`, `react-router-dom`, `i18next`, `react-i18next`, `lucide-react`, `autoprefixer`, `vite`, `vue`, `wrangler`, `@cloudflare/workers-types`, `prettier`, `typescript`, `eslint-plugin-react-hooks`, `globals`, `typescript-eslint`
- **infra**: Updated `eslint` and `@eslint/js` from v9 to v10, and `commander` from v13 to v14 - no API changes required, fixed two new `eslint:recommended` rules (`no-useless-assignment` in upload chunking code, `preserve-caught-error` in upload worker)
- **web**: Removed deprecated `@types/dompurify` - DOMPurify v3+ ships its own TypeScript declarations
- **infra**: Added `COPY apps/client/package.json`, `COPY apps/client/stubs/`, and `COPY workers/instances/package.json` to the Dockerfile build stage so `pnpm install --frozen-lockfile` can resolve all workspace packages (including the `file:` stub dependency in `@skysend/client`) before `COPY . .`

### 🗑️ Removed

- **server**: Removed `S3_PUBLIC_URL` environment variable. S3 downloads now exclusively use presigned URLs, which enforce expiry and download limits server-side and expire automatically. Public bucket URLs allowed clients to bypass these controls by reusing a captured URL.

### 📝 Documentation

- **docs**: Removed PBKDF2-SHA256 fallback references from `password-protection.md`, `README.md`, and `docs/index.md` - password protection now exclusively documents Argon2id

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.5.1`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.5.0 - Security Audit Fixes, Test Coverage Improvements, and Docker Metadata Labels
*Released: April 23, 2026*

### ✨ Features

- **server**: Added per-IP per-resource password attempt lockout - after 10 failed attempts the IP is locked out for 15 minutes with a `Retry-After` header, IPs stored as ephemeral HMAC-SHA256 hashes, configurable via `PASSWORD_MAX_ATTEMPTS` and `PASSWORD_LOCKOUT_MS`

### 🔒 Security

- **server**: Updated `hono` from `4.12.12` to `4.12.14` to fix HTML injection via improperly handled JSX attribute names in SSR (GHSA-458j-xx4x-4375)
- **infra**: Added `pnpm.overrides` for `esbuild` (`>=0.25.0`), `vite` (`>=6.4.2`), and `fast-xml-parser` (`>=5.7.0`) to patch transitive vulnerabilities in dev/docs dependencies (GHSA-67mh-4wv8-2f99, GHSA-4w7w-66w2-5vf9, GHSA-gh4j-gqv2-49f6)
- **crypto**: Tightened Argon2id-to-PBKDF2 fallback logic - the fallback now only triggers on WASM availability errors (`CompileError`, `LinkError`, or matching message) and propagates all other crypto errors instead of silently swallowing them
- **crypto**: Increased Argon2id parameters from 19 MiB / 2 iterations to 64 MiB / 3 iterations, matching OWASP's strong recommendation and significantly raising GPU brute-force cost for new password-protected uploads
- **crypto**: Increased HKDF salt length from 16 to 32 bytes for new uploads, matching the RFC 5869 recommendation to use a salt equal to the hash output length - legacy 16-byte salts from existing uploads are still accepted
- **crypto**: Added stream truncation detection to `createDecryptStream` - callers can pass `expectedPlaintextSize` (from authenticated metadata) to detect a malicious server delivering fewer records than were encrypted
- **server**: Added `Referrer-Policy: no-referrer` HTTP header to prevent URL fragments from leaking via `Referer` header in misconfigured or future environments
- **web**: Added `<meta name="referrer" content="no-referrer">` to `index.html` as defense-in-depth for the referrer policy
- **web**: URL fragment (encryption key) is now removed from the browser address bar via `history.replaceState` once decryption begins, preventing key leakage through browser history
- **web**: Note uploads now use Argon2id for password key derivation - previously PBKDF2 was always used for notes due to a missing argument
- **crypto**: Removed Argon2id-to-PBKDF2 upload fallback entirely - if Argon2id WASM fails during an upload, an error is thrown instead of silently downgrading to PBKDF2 ("fail secure"), PBKDF2 decryption for existing uploads is unaffected
- **web**: Added DOMPurify sanitization of highlight.js output before `dangerouslySetInnerHTML` in code notes - defense-in-depth against any future upstream hljs vulnerability
- **web**: Added `rehype-sanitize` plugin to ReactMarkdown rendering in notes - prevents XSS from future react-markdown upstream changes that could enable raw HTML
- **web**: URL fragment (encryption key) is now removed from the browser address bar via `history.replaceState` in `NoteView` immediately at page mount - previously only the Download page had this protection
- **server**: Fixed IP extraction when `TRUST_PROXY=true` - previously the leftmost (client-controlled) value from `X-Forwarded-For` was used, allowing clients to spoof their IP and bypass rate limiting and upload quotas, now uses the rightmost (proxy-appended) value
- **server**: Fixed S3 download with `S3_PUBLIC_URL` configured - previously a permanent public URL was returned, remaining valid indefinitely after DB record deletion and bypassing expiry/download-limit enforcement, now always uses presigned URLs with a TTL
- **web**: Replaced deprecated `apple-mobile-web-app-capable` meta tag with the standard `mobile-web-app-capable` equivalent - eliminates browser console warning, the PWA manifest `display: standalone` already handles standalone mode on modern browsers

### 🎨 Improvements

- **web**: Password prompt now shows a translated "too many attempts" error when the server returns 429 instead of switching away from the password screen

### 🔧 CI/CD

- **infra**: Added OCI standard labels to Docker images via `docker/metadata-action@v5` - sets `title`, `description`, `url`, `source`, `version`, `revision`, `created`, `vendor`, and `licenses` for better registry compatibility and Renovate/Dependabot integration

### 🧪 Tests

- **crypto**: Expanded to 129 tests with 100% coverage - added security-property tests for HKDF domain separation, ECE reorder/truncation attacks, Argon2id error propagation, PBKDF2 known-answer verification, and legacy salt backward compatibility.
- **server**: Added 24 integration tests for the chunked upload flow (`/init`, `/chunk`, `/finalize`), password-attempt lockout (429 + `Retry-After`), and invalid input handling across `meta.ts`, `password.ts`, and `note.ts` routes.
- **server**: Added 5 tests for `startCleanupJob` (interval, stop function, logging, error recovery) - bringing `cleanup.ts` to 100%.
- **server**: Brought `upload-validation.ts` and `quota.ts` to 100% - covers all `check()`, `getStatus()`, 413 middleware, DB key restoration, and interval behavior (rotation, expiry cleanup).
- **infra**: Added `vitest.config.ts` for `server` and `client`, updated `vite.config.ts` for `web` - all with scoped `coverage.include` and explicit excludes for untestable files (browser workers, WASM, S3 backend, app entrypoints).

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.5.0`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.4.3 - Codecov, Unit Test Improvements & Web Improvements
*Released: April 21, 2026*

### ✨ Features
- **client**: TUI "Manage servers" now supports adding, deleting, and setting a server as default via a server action sub-menu

### 🐛 Bug Fixes
- **web**: Fixed note view incorrectly showing "permanently deleted" warning for unlimited-view notes (`maxViews === 0`)

### 🧪 Tests
- **infra**: Added `@vitest/coverage-v8` and `test:coverage` scripts to `server`, `web`, `crypto`, and `client` packages for coverage report generation in LCOV format
- **web**: Added 57 unit tests across `lib/utils`, `lib/password-generator`, and `lib/upload-store` - covering formatting functions, `isSafari` detection, `generatePassword`/`calculateEntropy`, and full CRUD/sorting for IndexedDB upload and note storage (using an in-memory `idb-keyval` mock)
- **client**: Added 93 unit tests across `lib/progress`, `lib/url`, `lib/password-generator`, `lib/config`, and `lib/history` - covering all formatting/parsing utilities, full `parseShareUrl`/`buildShareUrl` logic including edge cases, password generation, config file lifecycle with filesystem isolation via `tmpdir`, and history CRUD with expiry cleanup

### 🔧 CI/CD
- **infra**: Updated `validate.yml` test job to run with coverage and upload reports to Codecov via `codecov/codecov-action@v5`
- **infra**: Added `codecov.yml` with project and patch coverage status checks
- **crypto**: Added 14 new unit tests covering previously untested security-critical paths: `validateMetadata` error branches (invalid JSON, null payload, unknown type, malformed archive entries, negative sizes, empty names, missing MIME type), `deriveKeyFromPasswordArgon2` input validation, ECE decrypt stream "record too short" path, and exact error message matching for the nonce-missing guard. Coverage: 94% → 99.29% statements, 88% → 97.82% branches. Added `vitest.config.ts` to exclude the re-export barrel `src/index.ts` from coverage.

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.4.3`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.4.2 - WebSocket Upload Toggle and CLI History Command
*Released: April 20, 2026*

### ✨ Features
- **client**: Added WebSocket transport toggle - disable WebSocket uploads via `--no-ws` CLI flag, TUI Settings menu, or `\"websocket\": false` in config file- **client**: Added `skysend ls` command to list upload and note history with age, expiry, and size - supports `--server`, `--all`, and `--json` flags

### 🎨 Improvements
- **client**: Connection error screen now offers recovery options - press `s` to select another server or `r` to retry instead of requiring Ctrl+C exit
- **client**: Connection errors now show a user-friendly message (`Server <url> is not reachable`) instead of the raw `fetch failed` error
- **client**: `skysend config` now shows all registered servers with their per-server WebSocket status

### 📝 Documentation
- **docs**: Added WebSocket transport configuration section to CLI client documentation

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.4.2`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.4.1 - Bug Fixes for CLI Binary and Client install URL Shortening
*Released: April 20, 2026*

### 🐛 Bug Fixes
- **client**: Fixed `Cannot find package 'react-devtools-core'` runtime error when running compiled CLI binaries - replaced `--external` flag with a bundled no-op stub so Ink's optional devtools import resolves inside the binary

### 📝 Documentation
- **docs**: Shortened CLI install URLs from raw GitHub links to `skysend.ch/install.sh` and `skysend.ch/install.ps1` redirects across README, docs, and install scripts

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.4.1`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.4.0 - CLI Client, PWA Support and ZIP creating improvements
*Released: April 19, 2026*

### ✨ Features
- **web**: Added PWA (Progressive Web App) support - SkySend can now be installed as an app on desktop (Chrome, Edge), Android, and iOS via "Add to Home Screen"
- **client**: Added `@skysend/client` CLI binary for uploading and downloading files with end-to-end encryption from the terminal - supports single/multi-file uploads, encrypted notes, password protection, WebSocket and HTTP chunked transports, and cross-platform Bun-compiled binaries (Linux, macOS, Windows)
- **web**: Added Argon2id password KDF support to the web frontend and upload worker using hash-wasm, enabling cross-compatibility with CLI password-protected uploads

### 🐛 Bug Fixes
- **web**: Fixed WebSocket upload failing through Vite dev proxy by enabling `ws: true` on the API proxy config

### 🎨 Improvements
- **web**: Multi-file uploads now show a determinate progress bar (0-100%) during the packing phase instead of an indeterminate spinner
- **web**: Multi-file ZIP creation moved from main thread into the upload worker, reducing peak memory usage by ~50% for large uploads
- **web**: Average upload speed is now displayed on the share link page after upload completes

### 🔄 Changed
- **cli**: Renamed admin CLI binary from `skysend` to `skysend-cli` to avoid conflict with the new client binary (consistent with Docker and documentation)

### 📝 Documentation
- **docs**: Cleaned up docker compose example in the user guide - removed redundant comments and simplified environment variable list with a link to the full reference
- **docs**: Added CLI client documentation - overview, installation guide (Linux/macOS/Windows), detailed command reference for all 7 commands (`upload`, `download`, `note`, `note:view`, `delete`, `config`, `update`)
- **docs**: Updated README, docs homepage, getting started, installation, first steps, architecture, setup, and roadmap pages with CLI client information

### 🔧 CI/CD
- **infra**: Added CLI binary build pipeline to release workflow - compiles Bun binaries for 5 targets (linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64) with SHA-256 checksums and attaches them to GitHub Releases
- **infra**: Added install scripts for Linux/macOS (`install.sh`) and Windows (`install.ps1`) with automatic platform detection and checksum verification

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.4.0`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.3.0 - WebSocket Upload Transport for Improved Performance in Proxied Environments
*Released: April 17, 2026*

### ✨ Features
- **server**: Added a WebSocket upload transport at `/api/upload/ws` that streams the encrypted payload over a single persistent connection, eliminating the HTTP/2 multiplexing bottleneck that reverse proxies (Traefik, Nginx) impose on parallel chunk uploads
- **server**: Added `FILE_UPLOAD_WS` environment variable (default: `true`) to enable or disable the WebSocket upload transport
- **server**: Added `FILE_UPLOAD_WS_MAX_BUFFER` environment variable (default: `16MB`) to cap the per-session server receive buffer for WebSocket uploads
- **web**: Upload worker now uses the WebSocket transport as the primary upload path and automatically falls back to the existing HTTP chunked upload when the handshake fails, is blocked, or times out (10 s)

### 🔒 Security
- **server**: Added `Origin` header validation on WebSocket upgrade requests to prevent cross-site WebSocket hijacking (defence-in-depth, not exploitable due to token requirements)

### 📝 Documentation
- **docs**: Added `FILE_UPLOAD_WS` and `FILE_UPLOAD_WS_MAX_BUFFER` to the user-guide environment variables page and the developer-guide environment reference
- **docs**: Documented the WebSocket upload protocol in the upload API reference, including message shapes, close codes, and client fallback triggers
- **docs**: Added Nginx and Traefik configuration snippets for the WebSocket upload transport in the reverse-proxy guide
- **docs**: Updated developer-guide architecture to document both WebSocket (primary) and HTTP chunked (fallback) upload transports with flow diagrams

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.3.0`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.2.4 - Max Concurrent Chunk Uploads and Speed Limit Configuration
*Released: April 15, 2026*

### ✨ Features
- **server**: Added `FILE_UPLOAD_CONCURRENT_CHUNKS` environment variable (default: `3`) to control the number of parallel chunk uploads per session - increase to improve upload speed in Chromium browsers through HTTP/2 proxies
- **server**: Added `FILE_UPLOAD_SPEED_LIMIT` environment variable (default: `0` = unlimited) to cap upload throughput per session - supports human-readable values like `100MB` (bytes per second)
- **web**: Client now reads the configured concurrent chunk count from the server and adjusts parallel uploads accordingly

### 📝 Documentation
- **docs**: Added `FILE_UPLOAD_CONCURRENT_CHUNKS` and `FILE_UPLOAD_SPEED_LIMIT` to user-guide environment variables page with new "Upload Performance" section
- **docs**: Added `FILE_UPLOAD_CONCURRENT_CHUNKS` and `FILE_UPLOAD_SPEED_LIMIT` to developer-guide environment reference

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.2.4`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.2.3 - Critical Bug Fixes for Chunked Uploads in HTTP/2 Proxied Environments
*Released: April 15, 2026*

- **server**: Fixed rate limiter path matching - the regex anchor (`^`) prevented chunk requests from being recognized through the `/api` sub-router, causing 429 errors despite the exemption
- **server**: Fixed HTTP/2 flow-control deadlock that caused uploads to stall at 0-1% in Chrome, Firefox, Brave, and Edge through reverse proxies - the server now reads each chunk body immediately instead of deferring reads in a promise chain, preventing proxy flow-control backpressure from blocking the connection

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.2.3`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.2.2 - Bug Fixes for Chunked Uploads in Brave and Edge
*Released: April 15, 2026*

### 🐛 Bug Fixes
- **server**: Chunk upload requests (`/upload/:id/chunk`) are now exempt from the global rate limiter - previously, uploading a large file would exceed the 60 requests/minute limit and cause 429 errors, breaking uploads entirely in production
- **web**: Chunk upload body changed from `Blob` to `ArrayBuffer` - fixes uploads permanently stalling at 0% in Brave and Edge, where the browser opened HTTP/2 streams but never sent DATA frames for Blob bodies from Web Workers

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.2.2`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.2.1 - Parallel Chunk Uploads and Performance Improvements
*Released: April 15, 2026*

### 🎨 Improvements
- **web**: Upload chunks are now sent in parallel (up to 3 concurrent, 10 MB each) instead of sequentially (50 MB each), dramatically improving upload speed in Chrome, Brave, and Edge through reverse proxies like Traefik
- **server**: Chunk upload endpoint accepts an `index` query parameter and reassembles chunks in-order on the server, ensuring data integrity with parallel client uploads
- **server**: In-order chunks are now streamed directly to storage without buffering, eliminating unnecessary memory copies on the hot path
- **server**: Optimized S3 multipart upload buffering to avoid full-buffer reallocation on every chunk append
- **server**: S3 part uploads now run as a concurrent pool with smooth backpressure - waits for one upload slot to free up instead of draining everything, giving consistent throughput instead of burst-stop cycles

### 📝 Documentation
- **docs**: Updated architecture diagram with chunked upload flow (init, parallel chunks with index, finalize)
- **docs**: Added chunked upload API documentation (init, chunk, finalize endpoints) to developer guide
- **docs**: Added chunked upload endpoints to API overview table

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.2.1`
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

- **Image**: `skyfay/skysend:v2.2.0`
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

- **Image**: `skyfay/skysend:v2.1.0`
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

- **Image**: `skyfay/skysend:v2.0.0`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v1.0.2 - Patch Release for CORS correction on Health Endpoint
*Released: April 13, 2026*

### 🐛 Bug Fixes
- **server**: Added open CORS policy (`*`) on `/api/health` endpoint so external sites can fetch instance status

### 📝 Documentation
- **docs**: Added website and instances links to README navigation bar

### 🐳 Docker

- **Image**: `skyfay/skysend:v1.0.2`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.0.1 - Patch Release for Docker Permissions Issue
*Released: April 12, 2026*

### 🐛 Bug Fixes

- **docker**: Replaced recursive `chown` on `/uploads` with a non-recursive, fault-tolerant call to prevent startup failures on NFS mounts and read-only filesystems

### ✨ Features

- **docker**: Added `SKIP_CHOWN` environment variable to skip ownership changes on `/data` and `/uploads` entirely

### 🐳 Docker

- **Image**: `skyfay/skysend:v1.0.1`
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
