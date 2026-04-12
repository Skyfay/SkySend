# Architecture

SkySend follows a simple client-server architecture with end-to-end encryption.

## High-Level Architecture

```
+-------------------+          +-------------------+
|    Browser (SPA)  |  HTTPS   |   Hono Server     |
|                   | <------> |                   |
|  React + Crypto   |          |  REST API         |
|  fflate (zip)     |          |  SQLite (Drizzle) |
|  IndexedDB        |          |  Filesystem       |
+-------------------+          +-------------------+
```

The browser handles all cryptographic operations. The server stores encrypted blobs and metadata without any knowledge of the plaintext content.

## Upload Flow

```
Client                                          Server
------                                          ------
1. Generate secret (32 bytes)
2. Derive fileKey, metaKey, authKey (HKDF)
3. Compute authToken, ownerToken
4. If multi-file: zip with fflate
5. Encrypt payload (streaming AES-256-GCM)
6. POST /api/upload (stream) ------------>  Store encrypted blob
                                            Create DB record
                                     <----  Return { id, url }
7. Encrypt metadata (names, types)
8. POST /api/meta/:id ----------------->  Store encrypted metadata
                                     <----  200 OK
9. Build share link: baseUrl/#secret
10. Store in IndexedDB (local history)
```

## Download Flow

```
Client                                          Server
------                                          ------
1. Parse secret from URL fragment (#)
2. GET /api/info/:id ------------------>  Return upload metadata
                                     <----  { size, salt, hasPassword, ... }
3. Derive keys from secret + salt
4. If password-protected:
   a. Prompt user for password
   b. Derive passwordKey
   c. Recover secret = protectedSecret XOR passwordKey
   d. POST /api/password/:id --------->  Verify auth token
                                     <----  200 OK
5. Decrypt metadata (name, type, etc.)
6. Select download strategy (see below)
7. GET /api/download/:id -------------->  Stream encrypted blob
   (X-Auth-Token header)                   Increment download count
                                     <----  Encrypted stream
8. Decrypt stream (AES-256-GCM ECE)
9. Save to disk via browser mechanism
```

### Download Strategy Selection

SkySend uses a tiered approach to handle large file downloads without exhausting RAM. See [Download Modes](./download-modes.md) for full details.

| Tier | Browsers | Method | RAM Usage |
| --- | --- | --- | --- |
| 1 | All modern browsers except Safari | Service Worker streaming decryption | Low (buffer only) |
| 2 | Chrome, Edge (fallback) | `showSaveFilePicker` API | Zero |
| 3 | Safari default / legacy fallback | Blob in memory | Full file size |

## Package Dependencies

```
@skysend/crypto    (shared, no dependencies on other packages)
       |
       +-----> @skysend/server  (imports crypto for validation)
       |
       +-----> @skysend/web     (imports crypto for encryption/decryption)

@skysend/cli       (accesses server database directly)
```

The `@skysend/crypto` package is the foundation. It is used by both the server (for token validation) and the web frontend (for encryption/decryption).

## Server Architecture

```
apps/server/src/
  index.ts              # Entry point, middleware, routes, graceful shutdown
  types.ts              # Shared TypeScript types
  routes/
    upload.ts           # POST /api/upload     - Streaming upload
    download.ts         # GET  /api/download   - Streaming download
    meta.ts             # POST /api/meta       - Save encrypted metadata
    info.ts             # GET  /api/info       - Public upload info
    password.ts         # POST /api/password   - Verify password
    delete.ts           # DELETE /api/upload    - Delete upload
    exists.ts           # GET  /api/exists     - Check existence
    health.ts           # GET  /api/health     - Health check
    config.ts           # GET  /api/config     - Server limits
  middleware/
    auth.ts             # Auth + owner token validation
    rate-limit.ts       # Per-IP sliding window rate limiter
    quota.ts            # HMAC-hashed IP upload quotas
  db/
    schema.ts           # Drizzle ORM schema
    index.ts            # Database connection + pragmas
    migrations/         # SQL migration files
  storage/
    filesystem.ts       # File read/write/delete with path traversal protection
  lib/
    config.ts           # Zod-validated environment variables
    cleanup.ts          # Expired upload cleanup job
```

## Frontend Architecture

```
apps/web/src/
  main.tsx              # Entry point
  App.tsx               # React Router setup
  pages/
    Upload.tsx          # Main upload page
    Download.tsx        # Download page (/d/:id)
    MyUploads.tsx       # Upload management dashboard
    NotFound.tsx        # 404 page
  components/
    UploadZone.tsx      # Drag & drop file selection
    UploadProgress.tsx  # Upload progress indicator
    ShareLink.tsx       # Share link display + copy
    DownloadCard.tsx    # Download UI
    PasswordPrompt.tsx  # Password input dialog
    ExpirySelector.tsx  # Expiry + download limit config
    UploadCard.tsx      # Single upload status card
    ui/                 # Shadcn UI components
  hooks/
    useUpload.ts        # Upload logic (encrypt + stream)
    useDownload.ts      # Download logic (tier selection + decrypt)
    useUploadHistory.ts # IndexedDB upload history
    useServerConfig.tsx # Fetch server config
    useTheme.tsx        # Dark/light mode
    useToast.ts         # Toast notifications
  lib/
    api.ts              # API client
    opfs-download.ts    # OPFS probe, SW stream, download triggers
    opfs-worker.ts      # Web Worker: fetch + decrypt + OPFS write
    upload-store.ts     # IndexedDB operations
    zip.ts              # Client-side zip/unzip (fflate)
    utils.ts            # Utility functions
  public/
    download-sw.js      # Service Worker: streaming ECE decryption
  i18n/
    index.ts            # i18next setup with auto-detection
    en.json             # English translations
    de.json             # German translations
```

## Data Storage

### Server-Side

- **SQLite database** (`data/skysend.db`) - Upload metadata, tokens, encrypted metadata
- **Filesystem** (`data/uploads/`) - Encrypted file blobs, one file per upload (`<uuid>.bin`)

### Client-Side

- **IndexedDB** (`skysend-uploads`) - Local upload history for the "My Uploads" dashboard
- **URL fragment** (`#secret`) - Encryption key, never stored or sent to server

## Security Layers

1. **Transport**: HTTPS (via reverse proxy)
2. **Encryption**: AES-256-GCM with HKDF-derived keys
3. **Authentication**: HMAC-SHA256 tokens with constant-time comparison
4. **Rate Limiting**: Per-IP sliding window
5. **Quotas**: HMAC-hashed IP with daily key rotation
6. **Cleanup**: Automatic expiry and download limit enforcement
7. **Storage**: Path traversal protection (UUID validation)
