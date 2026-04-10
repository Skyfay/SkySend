# Data & Backups

SkySend stores all persistent data in a single directory. This makes backups straightforward.

## Data Directory

By default, SkySend stores data in `./data` (configurable via `DATA_DIR`):

```
data/
  skysend.db          # SQLite database (upload metadata)
  skysend.db-wal      # Write-ahead log (temporary)
  skysend.db-shm      # Shared memory file (temporary)
  uploads/            # Encrypted upload files
    <uuid>.bin         # One file per upload
```

## What Is Stored

| File | Contents |
| --- | --- |
| `skysend.db` | Upload metadata: IDs, tokens, salt, encrypted metadata, expiry times, download counts |
| `uploads/*.bin` | Encrypted file payloads (AES-256-GCM ciphertext) |

::: info Zero Knowledge
The database contains only encrypted metadata and hashed tokens. No plaintext file content or file names are stored on the server. Even with full access to the data directory, an attacker cannot read the uploaded files without the share link.
:::

## Backup Strategy

### Simple Copy

The simplest backup method is to copy the entire data directory:

```bash
cp -r ./data ./data-backup-$(date +%Y%m%d)
```

SQLite with WAL mode supports safe concurrent reads, so you can copy the database while SkySend is running.

### Docker Volume

If using Docker, the volume is configured in `docker-compose.yml`:

```yaml
volumes:
  - "${DATA_DIR:-./data}:/app/data"
```

Back up the host-side directory.

## Restore

To restore from a backup:

1. Stop SkySend
2. Replace the data directory with the backup
3. Start SkySend

```bash
docker compose down
rm -rf ./data
cp -r ./data-backup-20250101 ./data
docker compose up -d
```

## Automatic Cleanup

SkySend automatically cleans up expired uploads. The cleanup job runs at the interval specified by `CLEANUP_INTERVAL` (default: 60 seconds).

Uploads are deleted when:
- The expiry time has passed (`expiresAt <= now`)
- The download limit has been reached (`downloadCount >= maxDownloads`)

Both the database record and the file on disk are removed.

You can also trigger cleanup manually via the [Admin CLI](/user-guide/admin-cli/commands):

```bash
skysend-cli cleanup
```
