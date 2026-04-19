# Architecture

SkySend follows a simple client-server architecture with end-to-end encryption.

## High-Level Architecture

```
+-------------------+          +-------------------+          +-------------------+
|    Browser (SPA)  |  HTTPS   |   Hono Server     |          |   S3 / Filesystem |
|                   | <------> |                   | <------> |                   |
|  React + Crypto   |          |  REST API         |          |  Encrypted Blobs  |
|  fflate (zip)     |   or     |  SQLite (Drizzle) |          |                   |
|  IndexedDB        | <------> |  Storage Adapter  |          |                   |
+-------------------+  S3 URL  +-------------------+          +-------------------+
                                        ^
+-------------------+                   |
|    CLI Client     |  HTTPS / WS       |
|                   | ------------------+
|  Commander.js     |
|  Crypto + fflate  |
|  Bun compile      |
+-------------------+
```

The browser and CLI client both handle all cryptographic operations. The server stores encrypted blobs and metadata without any knowledge of the plaintext content.

When using S3 storage, downloads bypass the server via presigned URLs - the client fetches the encrypted blob directly from S3 after the server has verified auth and counted the download.

## Upload Flow

SkySend supports two upload transports. The WebSocket transport is the primary path (lower overhead, single persistent connection). If the WebSocket handshake fails (proxy blocks upgrade, server has `FILE_UPLOAD_WS=false`, timeout), the client falls back to HTTP chunked uploads automatically. Both transports carry identical ciphertext - encryption happens before the transport decision.

### WebSocket Transport (Primary)

```
Client                                          Server
------                                          ------
1. Generate secret (32 bytes)
2. Derive fileKey, metaKey, authKey (HKDF)
3. Compute authToken, ownerToken
4. If multi-file: zip with fflate
5. WS connect /api/upload/ws -------->  Validate Origin header
6. Send JSON { type: "init",            Validate headers (shared schema)
     headers: auth, salt, limits }       Check quota
                                         Create empty storage entry
                                  <----  { type: "ready", id }
7. Encrypt payload (streaming AES-256-GCM)
   Send binary frames (256 KB each)     Buffer + flush to storage (4 MB)
   Client-side backpressure via          Verify bytes <= contentLength
   bufferedAmount high/low water
   Client-side speed limit throttle
   ...
8. Send JSON { type: "finalize" } --->  Verify total bytes == contentLength
                                         Flush remaining buffer
                                         Create DB record
                                         Record quota
                                  <----  { type: "done", id }
                                         Close 1000
9. Encrypt metadata (names, types)
10. POST /api/meta/:id ------------->  Store encrypted metadata
                                 <---- 200 OK
11. Build share link: baseUrl/#secret
12. Store in IndexedDB (local history)
```

Speed limiting for WebSocket uploads is enforced client-side. The server exposes `FILE_UPLOAD_SPEED_LIMIT` via `/api/config` and the client throttles its frame send rate accordingly. Server-side delays in `onMessage` cannot create backpressure because the `ws` library delivers frames independently of async handler state.

### HTTP Chunked Transport (Fallback)

```
Client                                          Server
------                                          ------
1. Generate secret (32 bytes)
2. Derive fileKey, metaKey, authKey (HKDF)
3. Compute authToken, ownerToken
4. If multi-file: zip with fflate
5. POST /api/upload/init ------------>  Validate headers
   (headers: auth, salt, limits)        Create empty storage entry
                                 <----  Return { id }
6. Encrypt payload (streaming AES-256-GCM)
   Split into 10 MB chunks
7. POST /api/upload/:id/chunk ------>  Buffer + write to storage
   ?index=0  (up to N parallel)        (in-order reassembly)
   ?index=1                      <---- 200 { bytesWritten }
   ?index=2                            Speed limit: delay response
   ...
8. POST /api/upload/:id/finalize -->  Verify total bytes match
   (X-Owner-Token header)             Create DB record
                                 <---- 200 OK
9. Encrypt metadata (names, types)
10. POST /api/meta/:id ------------->  Store encrypted metadata
                                 <---- 200 OK
11. Build share link: baseUrl/#secret
12. Store in IndexedDB (local history)
```

HTTP chunks are uploaded in parallel (up to `FILE_UPLOAD_CONCURRENT_CHUNKS`, default 3) with a chunk index query parameter. The server buffers out-of-order chunks in memory and writes them sequentially to the storage backend. Speed limiting works server-side by delaying the HTTP response - the client waits for the response before sending the next chunk.

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
                                     <----  Encrypted stream (filesystem)
                                           OR presigned S3 URL (S3 backend)
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

## Note Flow

Notes use the same key derivation and encryption as files, but content is stored in the database instead of the filesystem.

### Create Note

```
Client                                          Server
------                                          ------
1. Generate secret (32 bytes)
2. Derive metaKey, authKey (HKDF)
3. Compute authToken, ownerToken
4. Encrypt note content (AES-256-GCM + random IV)
5. POST /api/note ------------------>  Store encrypted content in DB
                                       Create DB record
                                <----  Return { id, expiresAt }
6. Build share link: baseUrl/note/:id#secret
7. Store in IndexedDB (local history)
```

### View Note

```
Client                                          Server
------                                          ------
1. Parse secret from URL fragment (#)
2. GET /api/note/:id ----------------->  Return note info
                                  <----  { salt, contentType, hasPassword, ... }
3. Derive keys from secret + salt
4. If password-protected:
   a. Prompt user for password
   b. Derive passwordKey
   c. Recover secret = protectedSecret XOR passwordKey
   d. POST /api/note/:id/password -->  Verify auth token
                                  <----  200 OK
5. POST /api/note/:id/view ---------->  Increment view count atomically
   (authToken in body)                  Return encrypted content
                                  <----  { encryptedContent, nonce, viewCount }
6. Decrypt content (AES-256-GCM)
7. Render based on contentType:
   - text: plain text
   - markdown: rendered GFM
   - password: masked fields with reveal/copy
   - code: syntax-highlighted with line numbers
   - sshkey: structured Public/Private Key sections
```

### Content Types

Notes support five content types, each with a dedicated UI:

| contentType | Description | Viewer |
| --- | --- | --- |
| `text` | Plain text | Whitespace-preserving display |
| `markdown` | Markdown (GFM) | Rendered HTML via react-markdown |
| `password` | One or more passwords | Per-password masked display with reveal/copy |
| `code` | Code snippets | Syntax highlighting (22 languages) with line numbers |
| `sshkey` | SSH key pairs | Structured Public Key / Private Key sections |

## Package Dependencies

```
@skysend/crypto    (shared, no dependencies on other packages)
       |
       +-----> @skysend/server  (imports crypto for validation)
       |
       +-----> @skysend/web     (imports crypto for encryption/decryption)
       |
       +-----> @skysend/client  (imports crypto for encryption/decryption)

@skysend/cli       (accesses server database directly)
```

The `@skysend/crypto` package is the foundation. It is used by the server (for token validation), the web frontend (for encryption/decryption in the browser), and the CLI client (for encryption/decryption on the command line).

## Server Architecture

```
apps/server/src/
  index.ts              # Entry point, middleware, routes, graceful shutdown
  types.ts              # Shared TypeScript types
  routes/
    upload.ts           # POST /api/upload     - HTTP chunked upload (fallback)
    upload-ws.ts        # WS   /api/upload/ws  - WebSocket upload (primary)
    download.ts         # GET  /api/download   - Streaming download
    meta.ts             # POST /api/meta       - Save encrypted metadata
    info.ts             # GET  /api/info       - Public upload info
    password.ts         # POST /api/password   - Verify password
    delete.ts           # DELETE /api/upload    - Delete upload
    exists.ts           # GET  /api/exists     - Check existence
    health.ts           # GET  /api/health     - Health check
    config.ts           # GET  /api/config     - Server limits
    note.ts             # POST /api/note       - Create note
                        # GET  /api/note/:id   - Note info
                        # POST /api/note/:id/view     - View note
                        # POST /api/note/:id/password - Verify password
                        # DELETE /api/note/:id        - Delete note
  middleware/
    auth.ts             # Auth + owner token validation
    rate-limit.ts       # Per-IP sliding window rate limiter
    quota.ts            # HMAC-hashed IP upload quotas
  db/
    schema.ts           # Drizzle ORM schema
    index.ts            # Database connection + pragmas
    migrations/         # SQL migration files
  storage/
    types.ts          # StorageBackend interface (adapter pattern)
    index.ts          # Storage factory (creates filesystem or S3 backend)
    filesystem.ts     # File read/write/delete with path traversal protection
    s3.ts             # S3-compatible storage (AWS, R2, Hetzner, MinIO, etc.)
  lib/
    config.ts           # Zod-validated environment variables
    cleanup.ts          # Expired upload cleanup job
    upload-validation.ts # Shared upload header validation (HTTP + WS)
```

## Frontend Architecture

```
apps/web/src/
  main.tsx              # Entry point
  App.tsx               # React Router setup
  pages/
    Upload.tsx          # Main upload page (tabs: File, Text, Password, Code, SSH Key)
    Download.tsx        # Download page (/file/:id)
    NoteView.tsx        # Note view page (/note/:id)
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
    NoteForm.tsx        # Note creation form (text, code, markdown)
    NoteContent.tsx     # Note content renderer (all 5 content types)
    NoteCard.tsx        # Note card in My Uploads
    PasswordForm.tsx    # Password note form (multi-password support)
    PasswordGenerator.tsx # Password generator with entropy display
    SSHKeyForm.tsx      # SSH key generation/paste form
    ui/                 # Shadcn UI components
  hooks/
    useUpload.ts        # Upload logic (encrypt + stream)
    useDownload.ts      # Download logic (tier selection + decrypt)
    useNoteUpload.ts    # Note upload logic (encrypt + submit)
    useUploadHistory.ts # IndexedDB upload history
    useServerConfig.tsx # Fetch server config
    useTheme.tsx        # Dark/light mode
    useToast.ts         # Toast notifications
  lib/
    api.ts              # API client
    opfs-download.ts    # OPFS probe, SW stream, download triggers
    opfs-worker.ts      # Web Worker: fetch + decrypt + OPFS write
    upload-store.ts     # IndexedDB operations
    upload-worker.ts    # Web Worker: encrypt + upload (WS primary, HTTP fallback)
    zip.ts              # Client-side zip/unzip (fflate)
    utils.ts            # Utility functions
  public/
    download-sw.js      # Service Worker: streaming ECE decryption
  i18n/
    index.ts            # i18next setup with auto-detection
    en.json             # English translations
    de.json             # German translations
    es.json             # Spanish translations
    fr.json             # French translations
    fi.json             # Finnish translations
    sv.json             # Swedish translations
    nb.json             # Norwegian translations
    nl.json             # Dutch translations
    it.json             # Italian translations
    pl.json             # Polish translations
```

## CLI Client Architecture

```
apps/client/src/
  index.ts              # Entry point (Commander.js program)
  commands/
    upload.ts           # skysend upload - file upload with E2E encryption
    download.ts         # skysend download - file download and decryption
    note.ts             # skysend note - create encrypted notes
    note-view.ts        # skysend note:view - view encrypted notes
    config.ts           # skysend config - manage client configuration
    delete.ts           # skysend delete - delete uploads/notes
    update.ts           # skysend update - self-update from GitHub Releases
  lib/
    api.ts              # API client (all server endpoints)
    auth.ts             # Key generation, derivation, password handling
    config.ts           # Config file management (~/.config/skysend/)
    errors.ts           # ApiError class
    progress.ts         # Terminal progress bar, formatting, password prompt
    url.ts              # Share URL parsing and building
```

The CLI client uses the same `@skysend/crypto` library and the same API endpoints as the web frontend. Key differences:

- **Argon2id**: Uses `hash-wasm` (pure WASM) instead of the browser WASM loader
- **Transport**: WebSocket primary with HTTP chunked fallback (same as web)
- **Storage**: Writes directly to the filesystem instead of browser download mechanisms
- **Distribution**: Compiled to a single binary with [Bun](https://bun.sh/) for each target platform

## Data Storage

### Server-Side

- **SQLite database** (`data/skysend.db`) - Upload metadata, tokens, encrypted metadata, and encrypted note content
- **Filesystem** (`data/uploads/`) - Encrypted file blobs, one file per upload (`<uuid>.bin`). Used when `STORAGE_BACKEND=filesystem` (default).
- **S3-compatible storage** - Encrypted file blobs stored as `<uuid>.bin` objects. Used when `STORAGE_BACKEND=s3`. Downloads use presigned URLs for direct client-to-S3 transfers.
- Notes are stored entirely in the database regardless of storage backend.

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
