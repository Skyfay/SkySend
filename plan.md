# SkySend - Implementation Plan

## Project Overview

SkySend is a minimalist, self-hostable, end-to-end encrypted file sharing service. The server never has access to the plaintext data at any time. No user accounts, no telemetry, no external service dependencies.

---

## Tech Stack

| Area             | Technology                  | Reasoning                                         |
| ---------------- | --------------------------- | ------------------------------------------------- |
| **Runtime**      | Node.js 24 LTS              | Stable, current LTS, native Streams               |
| **Backend**      | Hono                        | Minimal, Web-Standard APIs, Streaming-first       |
| **Frontend**     | Vite + React 19 + Shadcn UI | Fast build, no SSR overhead, pure SPA             |
| **ORM**          | Drizzle ORM                 | Lightweight, type-safe, SQLite-optimized          |
| **Database**     | SQLite (via better-sqlite3) | Zero Config, no DB-Server, Backup = 1 File        |
| **Crypto**       | Web Crypto API (native)     | No dependencies needed                            |
| **Validation**   | Zod                         | Strictly typed inputs and environment variables   |
| **i18n**         | react-i18next               | Multi-language auto-detection and fallback        |
| **Password KDF** | Argon2id (WASM)             | State-of-the-art, GPU-resistant                   |
| **Zip**          | fflate                      | Fast, lightweight, streaming zip/unzip in browser |
| **Storage**      | Local Filesystem            | Self-hosted, simple, reliable                     |
| **Build**        | Vite                        | Fast, modern, HMR                                 |
| **Docs**         | VitePress                   | Markdown-based, beautiful, simple                 |
| **Monorepo**     | pnpm Workspaces             | Fast, disk-efficient, native Workspaces           |
| **License**      | AGPLv3                      | Protects users from closed-source instances       |

---

## Cryptography Design

### Overview

```text
Browser (Client)                              Server
─────────────────                             ──────
1. Generate Secret Key (256-bit)
2. Derive Keys via HKDF-SHA256:
   - fileKey   (AES-256-GCM)
   - metaKey   (AES-256-GCM)
   - authKey   (HMAC-SHA256)
3. If multi-file/folder: Zip via fflate in browser
4. Chunked encryption of payload (64KB Records)
5. Encrypt Metadata (file names, sizes, type) with Random IV
6. Optional: Password via Argon2id
7. Send Encrypted Blob + Auth ────────> Saves only Ciphertext
                                        Does NOT know the Secret
8. Share-Link: https://host/#secret_base64url
   (Secret stays in the URL fragment, never sent to the server)
```

### Crypto Specification

| Component           | Algorithm / Value                                                 |
| ------------------- | ----------------------------------------------------------------- |
| Secret Key          | 256-bit Random (32 Bytes)                                         |
| Key Derivation      | HKDF-SHA256                                                       |
| File Encryption     | AES-256-GCM, 64KB Record Size                                     |
| Metadata Encryption | AES-256-GCM + Random IV (12 B)                                    |
| Nonce Handling      | Counter-based (XOR)                                               |
| Auth Token          | HMAC-SHA256                                                       |
| Password KDF        | Argon2id (WASM) or fallback PBKDF2-SHA256 with 600,000 Iterations |

### Key Derivation Schema

```text
Secret (32 Bytes, crypto.getRandomValues)
  |
  ├── HKDF(secret, salt, "skysend-file-encryption")  --> fileKey  (AES-256-GCM)
  ├── HKDF(secret, salt, "skysend-metadata")          --> metaKey  (AES-256-GCM)
  └── HKDF(secret, salt, "skysend-authentication")    --> authKey  (HMAC-SHA256)
```

### Streaming Encryption (File)

```text
Plaintext:  [  Chunk 1 (64KB)  ][  Chunk 2 (64KB)  ]...[  Chunk N (<=64KB)  ]
                  |                    |                        |
            AES-256-GCM          AES-256-GCM              AES-256-GCM
            Nonce = base XOR 1   Nonce = base XOR 2       Nonce = base XOR N
                  |                    |                        |
Ciphertext: [  Encrypted + Tag  ][  Encrypted + Tag  ]...[  Encrypted + Tag  ]
```

---

## Multi-File & Folder Upload Design

### Architecture

Multi-file and folder uploads are handled entirely client-side. The server always receives a single encrypted blob - it does not know whether the payload is a single file or an archive.

```text
Single File:   File ─────────────────────> Encrypt ──> Upload
Multi-File:    Files ──> Zip (fflate) ──> Encrypt ──> Upload
Folder:        Folder ─> Zip (fflate) ──> Encrypt ──> Upload
```

### Client-Side Flow

1. User selects file(s) via file picker, drag & drop, or folder picker
2. If `fileCount > 1` or folder: zip all files into a single archive using `fflate` (streaming)
3. Encrypted metadata includes: `type: 'single' | 'archive'`, file names, individual sizes
4. The (possibly zipped) payload is chunked-encrypted and streamed to the server
5. `X-File-Count` header tells the server how many files are in the upload

### Download Behavior

- Single file: download the decrypted file directly
- Archive: download as `.zip` file (the decrypted payload is already a valid zip)

### Limits

- `MAX_FILES_PER_UPLOAD` (default 32) - configurable by server owner
- `MAX_FILE_SIZE` still applies to the total payload (after zip, before encryption)

---

## Upload Management Design (Owner Dashboard)

### Architecture

Upload management is fully client-side - no accounts needed. After each upload, the browser stores metadata in IndexedDB:

```text
IndexedDB Store: "skysend-uploads"
┌──────────────────────────────────────────────────────────┐
│ { id, ownerToken, secret, fileNames, createdAt }         │
│ { id, ownerToken, secret, fileNames, createdAt }         │
│ ...                                                      │
└──────────────────────────────────────────────────────────┘
```

- **ownerToken**: used for `DELETE /api/upload/:id` (delete own uploads)
- **secret**: stored locally so the share link can be re-copied at any time
- The secret never leaves the browser - it is only used to reconstruct the `#fragment`

### My Uploads Page (`/uploads`)

- Lists all uploads stored in IndexedDB
- For each upload, fetches live status via `GET /api/info/:id`
- Shows: file name(s), download count / max downloads, expiry countdown, upload date
- Actions: copy share link, delete upload
- Expired or deleted uploads are automatically cleaned from IndexedDB
- Data is browser-local only - switching browsers loses the list

---

## Project Structure (Monorepo)

```text
skysend/
├── README.md                    # Project Description + Quick Start
├── PHILOSOPHY.md                # What the project is and isn't
├── CONTRIBUTING.md              # Contribution Guidelines
├── LICENSE                      # AGPLv3
├── plan.md                      # This Plan
│
├── .env.example                 # All configurable options
├── docker-compose.yml           # One-click Self-Hosting
├── Dockerfile                   # Multi-stage Build
├── .gitignore
├── .github/
│   └── copilot-instructions.md  # Coding Conventions for Copilot
│
├── package.json                 # Root (pnpm Workspaces)
├── pnpm-workspace.yaml
├── tsconfig.json                # Shared TypeScript Config
│
├── apps/
│   ├── server/                  # Hono Backend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts         # Server Entry Point
│   │       ├── routes/
│   │       │   ├── upload.ts    # POST /api/upload (Streaming)
│   │       │   ├── download.ts  # GET  /api/download/:id (Streaming)
│   │       │   ├── meta.ts      # GET/POST /api/meta/:id
│   │       │   └── info.ts      # GET  /api/info/:id (Expiry, DL-Count)
│   │       ├── db/
│   │       │   ├── schema.ts    # Drizzle Schema
│   │       │   ├── index.ts     # DB Connection
│   │       │   └── migrations/  # Drizzle Migrations
│   │       ├── storage/
│   │       │   └── filesystem.ts # File Storage
│   │       ├── middleware/
│   │       │   └── auth.ts      # Auth Token Validation
│   │       └── lib/
│   │           ├── config.ts    # Load Env Variables
│   │           └── cleanup.ts   # Delete expired uploads
│   │
│   ├── web/                     # React SPA (Vite)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   ├── tailwind.config.ts
│   │   └── src/
│   │       ├── main.tsx         # Entry Point
│   │       ├── App.tsx          # Router Setup
│   │       ├── pages/
│   │       │   ├── Upload.tsx   # Upload Page (Main)
│   │       │   ├── Download.tsx # Download Page (/d/:id)
│   │       │   ├── MyUploads.tsx # Upload Management (Owner Dashboard)
│   │       │   └── NotFound.tsx # 404
│   │       ├── components/
│   │       │   ├── ui/          # Shadcn UI Components
│   │       │   ├── UploadZone.tsx
│   │       │   ├── FileList.tsx      # Multi-file selection list
│   │       │   ├── UploadProgress.tsx
│   │       │   ├── ShareLink.tsx
│   │       │   ├── UploadList.tsx    # Owner's upload history list
│   │       │   ├── UploadCard.tsx    # Single upload status card
│   │       │   ├── DownloadCard.tsx
│   │       │   ├── PasswordPrompt.tsx
│   │       │   └── ExpirySelector.tsx
│   │       ├── lib/
│   │       │   ├── api.ts       # API Client
│   │       │   ├── zip.ts       # Client-side zip/unzip (fflate)
│   │       │   ├── upload-store.ts # IndexedDB store for upload history
│   │       │   └── utils.ts     # Shadcn cn() etc.
│   │       └── hooks/
│   │           ├── useUpload.ts
│   │           ├── useDownload.ts
│   │           └── useUploadHistory.ts # Read/manage stored uploads
│   │
│   └── cli/                     # Admin CLI Tool
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts         # CLI Entry Point
│           ├── commands/
│           │   ├── list.ts      # Show active uploads
│           │   ├── delete.ts    # Delete upload manually
│           │   ├── stats.ts     # Storage overview
│           │   ├── cleanup.ts   # Trigger manual cleanup
│           │   └── config.ts    # Show/edit limits
│           └── lib/
│               └── format.ts    # Output Formatting
│
├── packages/
│   └── crypto/                  # Shared Encryption Library
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts         # Public API
│           ├── keychain.ts      # Key Generation + Derivation
│           ├── ece.ts           # Encrypted Content Encoding (Streaming)
│           ├── metadata.ts      # Metadata Encryption/Decryption
│           ├── password.ts      # Argon2id / PBKDF2 Password KDF
│           └── util.ts          # Base64url, Encoding Helpers
│
└── docs/                        # VitePress Documentation
    ├── package.json
    ├── .vitepress/
    │   └── config.ts            # VitePress Config
    ├── index.md                 # Landing Page
    ├── guide/
    │   ├── getting-started.md   # Quick Start
    │   ├── self-hosting.md      # Self-Hosting Instructions
    │   ├── configuration.md     # All Env Variables Explained
    │   └── admin-cli.md         # CLI Commands
    ├── security/
    │   ├── encryption.md        # Crypto Design in detail
    │   └── threat-model.md      # Threat Model
    └── development/
        ├── architecture.md      # Architecture Overview
        ├── contributing.md      # Dev Setup + Guidelines
        └── api.md               # REST API Documentation
```

---

## Database Schema (SQLite)

```sql
CREATE TABLE uploads (
    id              TEXT PRIMARY KEY,         -- UUID v4
    owner_token     TEXT NOT NULL,            -- HMAC-based, for deletion
    auth_token      TEXT NOT NULL,            -- Derived from Secret
    encrypted_meta  BLOB,                     -- AES-256-GCM encrypted Metadata
    nonce           BLOB,                     -- IV for Metadata
    size            INTEGER NOT NULL,         -- Total payload size in Bytes
    file_count      INTEGER DEFAULT 1,        -- Number of files (1 = single, >1 = zip archive)
    has_password    BOOLEAN DEFAULT FALSE,    -- Is password protection active?

    max_downloads   INTEGER NOT NULL,         -- Max. number of downloads
    download_count  INTEGER DEFAULT 0,        -- Current download count

    expires_at      DATETIME NOT NULL,        -- Expiry timestamp
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- Storage path relative to upload directory
    storage_path    TEXT NOT NULL
);

CREATE INDEX idx_uploads_expires_at ON uploads(expires_at);
```

### SQLite Configuration

SQLite in WAL mode is more than sufficient for a self-hosted single-instance service. No Redis or external database needed.

```sql
PRAGMA journal_mode = WAL;        -- Concurrent reads + serialized writes
PRAGMA busy_timeout = 5000;       -- Wait up to 5s on lock contention instead of failing
PRAGMA synchronous = NORMAL;      -- Safe with WAL, better write performance
PRAGMA foreign_keys = ON;         -- Enforce referential integrity
```

**Concurrency rationale**: Download count updates (`download_count = download_count + 1`) are atomic and hold the write lock for microseconds. WAL mode allows thousands of such writes per second while reads are never blocked. Even 50+ concurrent downloads of the same file will not cause contention.

---

## API Endpoints

| Method | Path                | Description                           | Auth        |
| ------ | ------------------- | ------------------------------------- | ----------- |
| GET    | `/api/config`       | Fetch server configuration (Limits)   | -           |
| POST   | `/api/upload`       | Upload encrypted file/archive stream  | -           |
| POST   | `/api/meta/:id`     | Save encrypted metadata               | Owner Token |
| GET    | `/api/info/:id`     | Upload Info (Size, Expiry, DLs)       | -           |
| GET    | `/api/download/:id` | Fetch encrypted file stream           | Auth Token  |
| POST   | `/api/password/:id` | Verify password                       | Auth Token  |
| DELETE | `/api/upload/:id`   | Manually delete upload                | Owner Token |
| GET    | `/api/exists/:id`   | Check if upload exists                | -           |
| GET    | `/api/health`       | Health check (for Docker, monitoring) | -           |

### Upload Flow

```text
Client                                          Server
──────                                          ──────
1. POST /api/upload
   Headers:
     X-Max-Downloads: 10
     X-Expire-Sec: 86400
     X-File-Count: 3
     Content-Length: 1048576
   Body: <encrypted stream>
   (If multi-file/folder: client zips first, then encrypts)
                                         2. Generates Upload-ID
                                         3. Streams Body to Disk
                                         4. Creates DB Entry
                                     <── 5. Response:
                                            { id, ownerToken, url }

6. POST /api/meta/:id
   Headers:
     X-Owner-Token: <ownerToken>
   Body: { encryptedMeta, nonce }
                                         7. Saves encrypted Meta
                                     <── 8. 200 OK
```

### Download Flow

```text
Client                                          Server
──────                                          ──────
1. GET /api/info/:id
                                     <── 2. { size, fileCount, hasPassword, downloadCount, maxDownloads }

   (If password is set:)
3. POST /api/password/:id
   Body: { authToken }               <── 4. 200 OK / 401

5. GET /api/download/:id
   Headers:
     X-Auth-Token: <authToken>
                                         6. Checks Auth + Download Limit
                                         7. Increments download_count
                                     <── 8. Stream: <encrypted file>
                                            + Headers with Meta
```

---

## Phase Plan

### Phase 0 - Project Setup (Done)

- [x] Initialize Git Repository
- [x] Plan Project Structure
- [x] Define Tech Stack
- [x] Specify Crypto Design
- [x] Setup Monorepo with pnpm Workspaces
- [x] Project Configuration files (.gitignore, .env.example, LICENSE)
- [x] Create Dockerfile and docker-compose.yml
- [x] Create Copilot Instructions
- [x] Configure TypeScript
- [x] Configure ESLint + Prettier

### Phase 1 - Crypto Library (`packages/crypto`)

> Located in `packages/crypto` - shared library used by both apps/server and apps/web

**Priority: HIGH - Core of the project**

- [ ] `keychain.ts` - Key Generation (256-bit Secret)
- [ ] `keychain.ts` - HKDF Key Derivation (fileKey, metaKey, authKey)
- [ ] `ece.ts` - Streaming AES-256-GCM Encryption (64KB Chunks)
- [ ] `ece.ts` - Streaming AES-256-GCM Decryption
- [ ] `metadata.ts` - Metadata Encryption with Random IV
- [ ] `metadata.ts` - Metadata Decryption
- [ ] `password.ts` - Argon2id via WASM
- [ ] `password.ts` - PBKDF2-SHA256 Fallback (600,000 Iterations)
- [ ] `util.ts` - Base64url, ArrayBuffer Helpers
- [ ] Unit Tests for all Crypto Functions
- [ ] Integration Test: Encrypt -> Decrypt Roundtrip

### Phase 2 - Backend (`apps/server`)

**Priority: HIGH**

- [ ] Hono Server Setup + Config Loading
- [ ] Drizzle ORM + SQLite Schema + Migrations
- [ ] Filesystem Storage Layer
- [ ] `GET /api/config` - Provide Server Limits for Client
- [ ] `POST /api/upload` - Streaming Upload to Disk (supports single file and multi-file/folder archives)
- [ ] `POST /api/meta/:id` - Save Metadata
- [ ] `GET /api/info/:id` - Fetch Upload Info
- [ ] `GET /api/download/:id` - Streaming Download
- [ ] `POST /api/password/:id` - Password Verification
- [ ] `DELETE /api/upload/:id` - Delete Upload
- [ ] `GET /api/exists/:id` - Check Existence
- [ ] `GET /api/health` - Health Check Endpoint
- [ ] Auth Middleware (Token Validation)
- [ ] Cleanup Job (delete expired uploads, interval)
- [ ] Rate Limiting
- [ ] Upload Quota (per-user volume limit, privacy-preserving hashed IP)
- [ ] Request Validation (Zod) + Error Handling
- [ ] Static SPA Serving (Vite Build)
- [ ] Unit and Integration Tests

### Phase 3 - Frontend (`apps/web`)

**Priority: HIGH**

- [ ] Vite + React + TailwindCSS Setup
- [ ] Initialize Shadcn UI + Theme
- [ ] Initialize react-i18next (Auto-detect + EN fallback)
- [ ] React Router Setup (/, /d/:id, /uploads, 404)
- [ ] Upload Page
  - [ ] Drag & Drop Zone (UploadZone) - supports files and folders
  - [ ] Single File Selection
  - [ ] Multi-File Selection (up to `MAX_FILES_PER_UPLOAD`)
  - [ ] Folder Selection (via directory picker)
  - [ ] File List Preview (FileList component - add/remove files before upload)
  - [ ] Client-Side Zip (fflate) for multi-file/folder uploads
  - [ ] Expiry Configuration (Time + Max Downloads)
  - [ ] Optional Password Field
  - [ ] Upload Progress Indicator
  - [ ] Share Link Display with Copy Button
- [ ] Upload Management Page (My Uploads)
  - [ ] IndexedDB Store for upload history (id, ownerToken, secret, fileNames, createdAt)
  - [ ] List of user's uploads (UploadList + UploadCard components)
  - [ ] Fetch live status per upload via `GET /api/info/:id`
  - [ ] Show download count, remaining downloads, expiry countdown
  - [ ] Re-copy share link
  - [ ] Delete upload (via `DELETE /api/upload/:id` with owner token)
  - [ ] Auto-cleanup of expired/deleted entries from IndexedDB
- [ ] Download Page
  - [ ] Load Upload Info (Size, Downloads, Expiry)
  - [ ] Password Input (if needed)
  - [ ] Download Button + Progress
  - [ ] Error Handling (expired, limit reached, not found)
- [ ] Crypto Integration
  - [ ] Read Secret from URL Fragment (#...)
  - [ ] Chunked Encryption in Browser (Upload)
  - [ ] Chunked Decryption in Browser (Download)
  - [ ] Load Argon2id WASM
  - [ ] Zip before encrypt (multi-file/folder upload)
  - [ ] Decrypt then unzip (multi-file download - serve as .zip)
- [ ] Responsive Design (Mobile + Desktop)
- [ ] Dark Mode
- [ ] Accessibility (a11y)
- [ ] E2E Tests (Playwright)

### Phase 4 - Admin CLI (`apps/cli`)

**Priority: MEDIUM**

- [ ] CLI Framework (e.g., Commander.js or cac)
- [ ] `send-admin list` - Show active uploads
- [ ] `send-admin delete <id>` - Delete upload
- [ ] `send-admin stats` - Storage overview
- [ ] `send-admin cleanup` - Manual cleanup
- [ ] `send-admin config` - Show limits

### Phase 5 - Docker & Deployment

**Priority: HIGH**

- [ ] Finalize Multi-Stage Dockerfile (optimize layers, .dockerignore)
- [ ] Docker Compose Health Check (`healthcheck:` block)
- [ ] Graceful Shutdown (handle SIGTERM)
- [ ] Test Data Persistence (Volumes)
- [ ] Production Optimizations (Compression, Caching Headers)

### Phase 6 - Documentation (`docs/`)

**Priority: MEDIUM**

- [ ] VitePress Setup + Theme Configuration
- [ ] Landing Page (index.md)
- [ ] Getting Started Guide
- [ ] Self-Hosting Instructions (Docker, Reverse Proxy)
- [ ] Configuration Reference (all Env Variables)
- [ ] Admin CLI Documentation
- [ ] Crypto Design Documentation (public audit material)
- [ ] Threat Model
- [ ] API Documentation
- [ ] Architecture Overview
- [ ] GitHub Pages Deployment for Docs

### Phase 7 - Hardening & Polish

**Priority: MEDIUM**

- [ ] Security Headers (CSP, HSTS, X-Frame-Options)
- [ ] CORS Configuration
- [ ] Review Input Sanitization
- [ ] Crypto Code Review
- [ ] Performance Tests (large files, many parallel uploads)
- [ ] Error Boundary in Frontend
- [ ] Loading States + Skeleton UI
- [ ] Favicon + Open Graph Meta Tags
- [ ] `robots.txt` + `security.txt`

### Phase 8 - CI/CD & Release

**Priority: LOW (later)**

- [ ] GitHub Actions: Lint + Test on PR
- [ ] GitHub Actions: Build + Push Docker Image (GHCR)
- [ ] Semantic Versioning + Changelog
- [ ] Release Workflow (Tag -> Build -> Publish)
- [ ] Configure Dependabot

---

## Setup / Workflow Order

```text
Phase 0 (Setup)
    |
    v
Phase 1 (Crypto) ──────> Phase 2 (Backend)
                              |
                              v
                          Phase 3 (Frontend)
                              |
                              v
                   Phase 5 (Docker) + Phase 4 (CLI)
                              |
                              v
                   Phase 6 (Docs) + Phase 7 (Hardening)
                              |
                              v
                        Phase 8 (CI/CD)
```

Crypto is the foundation for everything. Backend and Frontend build upon it. Docker is built in parallel with the CLI, as soon as Backend + Frontend are ready.

---

## Environment Variables

| Variable               | Default                  | Description                                          |
| ---------------------- | ------------------------ | ---------------------------------------------------- |
| `PORT`                 | `3000`                   | Server Port                                          |
| `HOST`                 | `0.0.0.0`                | Server Host                                          |
| `BASE_URL`             | `http://localhost:3000`  | Public URL of the instance                           |
| `DATA_DIR`             | `./data`                 | Directory for DB + Uploads                           |
| `MAX_FILE_SIZE`        | `2GB`                    | Maximum file size                                    |
| `EXPIRE_OPTIONS_SEC`   | `300,3600,86400,604800`  | Selectable expiry times (array)                      |
| `DEFAULT_EXPIRE_SEC`   | `86400`                  | Default expiry time (1 day)                          |
| `DOWNLOAD_OPTIONS`     | `1,2,3,4,5,10,20,50,100` | Selectable download limits                           |
| `DEFAULT_DOWNLOAD`     | `1`                      | Default download limit                               |
| `CLEANUP_INTERVAL`     | `60`                     | Interval for Cleanup Job (in seconds)                |
| `SITE_TITLE`           | `SkySend`                | Displayed Site Title                                 |
| `RATE_LIMIT_WINDOW`    | `60000`                  | Rate Limit Window (in milliseconds)                  |
| `RATE_LIMIT_MAX`       | `60`                     | Max Requests per Window                              |
| `UPLOAD_QUOTA_BYTES`   | `0`                      | Max upload volume per user per window (0 = disabled) |
| `UPLOAD_QUOTA_WINDOW`  | `86400`                  | Quota time window in seconds (default 24h)           |
| `MAX_FILES_PER_UPLOAD` | `32`                     | Max number of files per upload (multi-file)          |

---

## Security Checklist

- [ ] Secret Key is NEVER sent to the server (only in URL fragment #)
- [ ] Server stores ONLY encrypted data
- [ ] Argon2id for Password KDF (min. 600,000 PBKDF2 iterations as fallback)
- [ ] AES-256-GCM with Random Nonce for Metadata
- [ ] Counter-based Nonces for File Chunks (no reuse)
- [ ] Auth Token is cryptographically derived, not guessable
- [ ] Rate Limiting on all endpoints
- [ ] Upload Quota uses hashed IPs only (HMAC-SHA256 with daily rotating key, no plaintext IPs stored)
- [ ] Content-Security-Policy Header
- [ ] No eval(), no innerHTML with User Input
- [ ] Dependencies regularly checked for security vulnerabilities
- [ ] OWASP Top 10 covered
