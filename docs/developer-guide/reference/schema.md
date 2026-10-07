# Database Schema

SkySend uses SQLite with Drizzle ORM. The database file is located at `data/db/skysend.db`.

## SQLite Configuration

```sql
PRAGMA journal_mode = WAL;        -- Concurrent reads + serialized writes
PRAGMA busy_timeout = 5000;       -- Wait up to 5s on lock contention
PRAGMA synchronous = NORMAL;      -- Safe with WAL, better write performance
PRAGMA foreign_keys = ON;         -- Enforce referential integrity
```

WAL (Write-Ahead Logging) mode allows concurrent reads while writes are serialized. This is more than sufficient for a single-instance self-hosted service.

## Tables

### uploads

| Column | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | TEXT (PK) | - | UUID v4 |
| `ownerToken` | TEXT NOT NULL | - | Base64url-encoded owner token |
| `authToken` | TEXT NOT NULL | - | Base64url-encoded auth token |
| `salt` | BLOB NOT NULL | - | HKDF salt (16 bytes) |
| `encryptedMeta` | BLOB | NULL | AES-256-GCM encrypted metadata |
| `nonce` | BLOB | NULL | Metadata IV (12 bytes) |
| `size` | INTEGER NOT NULL | - | Total payload size in bytes |
| `fileCount` | INTEGER | 1 | Number of files (1 = single, >1 = archive) |
| `hasPassword` | INTEGER | 0 | Whether password protection is active |
| `passwordSalt` | BLOB | NULL | Password KDF salt (16 bytes) |
| `passwordAlgo` | TEXT | NULL | `"argon2id-v2"` |
| `maxDownloads` | INTEGER NOT NULL | - | Maximum allowed downloads |
| `downloadCount` | INTEGER | 0 | Current download count |
| `expiresAt` | TIMESTAMP NOT NULL | - | Expiry timestamp (Unix epoch) |
| `createdAt` | TIMESTAMP | `current_unix_time` | Creation timestamp |
| `storagePath` | TEXT NOT NULL | - | Filename on disk (UUID.bin) |

### Indexes

| Index | Column | Purpose |
| --- | --- | --- |
| `idx_uploads_expires_at` | `expiresAt` | Efficient cleanup queries |

### notes

| Column | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | TEXT (PK) | - | UUID v4 |
| `ownerToken` | TEXT NOT NULL | - | Base64url-encoded owner token |
| `authToken` | TEXT NOT NULL | - | Base64url-encoded auth token |
| `salt` | BLOB NOT NULL | - | HKDF salt (16 bytes) |
| `encryptedContent` | BLOB NOT NULL | - | AES-256-GCM encrypted note content |
| `nonce` | BLOB NOT NULL | - | AES-GCM IV (12 bytes) |
| `contentType` | TEXT NOT NULL | - | `"blocks"`, or for a note from before v3 `"text"`, `"password"`, `"code"`, `"markdown"` or `"sshkey"` |
| `hasPassword` | INTEGER NOT NULL | 0 | Whether password protection is active |
| `passwordSalt` | BLOB | NULL | Password KDF salt (16 bytes) |
| `passwordAlgo` | TEXT | NULL | `"argon2id-v2"` |
| `maxViews` | INTEGER NOT NULL | - | Maximum allowed views (0 = unlimited) |
| `viewCount` | INTEGER NOT NULL | 0 | Current view count |
| `expiresAt` | TIMESTAMP NOT NULL | - | Expiry timestamp (Unix epoch) |
| `createdAt` | TIMESTAMP NOT NULL | `current_unix_time` | Creation timestamp |

### Indexes (notes)

| Index | Column | Purpose |
| --- | --- | --- |
| `idx_notes_expires_at` | `expiresAt` | Efficient cleanup queries |

### file_requests

| Column | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | TEXT (PK) | - | UUID v4 |
| `vault` | BLOB NOT NULL | - | The requester's private key, sealed with a key from the inbox link (146 bytes) |
| `vaultNonce` | BLOB NOT NULL | - | Vault IV (12 bytes) |
| `inboxAuthToken` | TEXT NOT NULL | - | SHA-256 of the token from the inbox link for reading, base64url |
| `inboxOwnerToken` | TEXT NOT NULL | - | SHA-256 of the token from the inbox link for managing, base64url |
| `uploadToken` | TEXT NOT NULL | - | SHA-256 of the token from the upload link, base64url |
| `titleCiphertext` | BLOB | NULL | AES-256-GCM encrypted title |
| `titleNonce` | BLOB | NULL | Title IV (12 bytes) |
| `hasPassword` | INTEGER NOT NULL | 0 | Whether the inbox link is password protected |
| `maxUploads` | INTEGER NOT NULL | - | Uploads the request takes |
| `maxSize` | INTEGER NOT NULL | - | Most bytes one upload may have |
| `reservedUploads` | INTEGER NOT NULL | 0 | Uploads running or finished. Set back to `finishedUploads` at startup. |
| `finishedUploads` | INTEGER NOT NULL | 0 | Uploads that finished. Never goes down, so a deleted upload keeps its slot. |
| `finishedBytes` | INTEGER NOT NULL | 0 | Bytes of uploads that finished |
| `closed` | INTEGER NOT NULL | 0 | Closed by the requester |
| `closesAt` | TIMESTAMP NOT NULL | - | When the request stops taking uploads |
| `createdAt` | TIMESTAMP NOT NULL | `current_unix_time` | Creation timestamp |

The public key of a request is never stored. It only exists in the upload link and inside the vault.

### request_uploads

| Column | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | TEXT (PK) | - | UUID v4 |
| `requestId` | TEXT NOT NULL | - | The request, deleted with it (`ON DELETE CASCADE`) |
| `size` | INTEGER NOT NULL | - | Encrypted size in bytes |
| `fileCount` | INTEGER NOT NULL | 1 | Number of files (1 = single, >1 = archive) |
| `salt` | BLOB NOT NULL | - | HKDF salt of the file (32 bytes) |
| `wrapEnc` | BLOB NOT NULL | - | HPKE encapsulated key (65 bytes) |
| `wrapCiphertext` | BLOB NOT NULL | - | The file secret sealed to the request's public key (48 bytes) |
| `encryptedMeta` | BLOB NOT NULL | - | AES-256-GCM encrypted metadata |
| `metaNonce` | BLOB NOT NULL | - | Metadata IV (12 bytes) |
| `maxDownloads` | INTEGER NOT NULL | - | `FILE_REQUEST_DOWNLOADS` at the time of the upload |
| `downloadCount` | INTEGER NOT NULL | 0 | Current download count |
| `expiresAt` | TIMESTAMP NOT NULL | - | `FILE_REQUEST_RETENTION_SEC` after the upload arrived |
| `createdAt` | TIMESTAMP NOT NULL | `current_unix_time` | Creation timestamp |
| `storagePath` | TEXT NOT NULL | - | Filename on disk (UUID.bin) |

Files of a request live in this table and never in `uploads`, so no route of a normal upload can serve one.

### Indexes (file requests)

| Index | Column | Purpose |
| --- | --- | --- |
| `idx_file_requests_closes_at` | `closesAt` | Cleanup of requests that are over |
| `idx_request_uploads_request_id` | `requestId` | Listing an inbox |
| `idx_request_uploads_expires_at` | `expiresAt` | Efficient cleanup queries |

## Concurrency

Download and view count updates are atomic SQL operations that hold the write lock for microseconds. WAL mode allows thousands of such writes per second while reads are never blocked.

The download route uses an atomic SQL update with a `WHERE` condition to prevent race conditions:

```sql
UPDATE uploads
SET downloadCount = downloadCount + 1
WHERE id = ? AND downloadCount < maxDownloads
```

The note view route uses the same pattern:

```sql
UPDATE notes
SET view_count = view_count + 1
WHERE id = ? AND (max_views = 0 OR view_count < max_views)
```

If the limit is already reached, the update affects zero rows and the request is rejected. For notes with `max_views = 0` (unlimited), the view count is always incremented.

## Migrations

Database migrations are managed by Drizzle ORM and stored in `apps/server/src/db/migrations/`. Migrations run automatically on server startup.
