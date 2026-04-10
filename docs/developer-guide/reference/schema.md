# Database Schema

SkySend uses SQLite with Drizzle ORM. The database file is located at `data/skysend.db`.

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
| `passwordAlgo` | TEXT | NULL | `"argon2id"` or `"pbkdf2"` |
| `maxDownloads` | INTEGER NOT NULL | - | Maximum allowed downloads |
| `downloadCount` | INTEGER | 0 | Current download count |
| `expiresAt` | TIMESTAMP NOT NULL | - | Expiry timestamp (Unix epoch) |
| `createdAt` | TIMESTAMP | `current_unix_time` | Creation timestamp |
| `storagePath` | TEXT NOT NULL | - | Filename on disk (UUID.bin) |

### Indexes

| Index | Column | Purpose |
| --- | --- | --- |
| `idx_uploads_expires_at` | `expiresAt` | Efficient cleanup queries |

## Concurrency

Download count updates (`downloadCount = downloadCount + 1`) are atomic SQL operations that hold the write lock for microseconds. WAL mode allows thousands of such writes per second while reads are never blocked.

The download route uses an atomic SQL update with a `WHERE` condition to prevent race conditions:

```sql
UPDATE uploads
SET downloadCount = downloadCount + 1
WHERE id = ? AND downloadCount < maxDownloads
```

If `maxDownloads` is already reached, the update affects zero rows and the request is rejected.

## Migrations

Database migrations are managed by Drizzle ORM and stored in `apps/server/src/db/migrations/`. Migrations run automatically on server startup.
