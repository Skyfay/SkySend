# Data & Backups

SkySend stores persistent data in two separate locations. Both need to be backed up.

## Data Directory

The database lives in `./data` (configurable via `DATA_DIR`):

```
data/
  db/
    skysend.db          # SQLite database (upload metadata)
    skysend.db-wal      # Write-ahead log (temporary)
    skysend.db-shm      # Shared memory file (temporary)
```

Encrypted upload files are stored separately in `./uploads` by default (configurable via `UPLOADS_DIR`). In the Docker image, this defaults to `/uploads` as a dedicated volume:

```
uploads/
  <uuid>.bin            # One encrypted file per upload
```

## What Is Stored

| File | Contents |
| --- | --- |
| `skysend.db` | Upload metadata: IDs, tokens, salt, encrypted metadata, expiry times, download counts |
| `uploads/*.bin` | Encrypted file payloads (AES-256-GCM ciphertext). Only present when using filesystem storage. |

::: tip S3 Storage
When using `STORAGE_BACKEND=s3`, encrypted files are stored in your S3 bucket instead of the local `uploads/` directory. You only need to back up the `data/` directory (SQLite database). The S3 bucket should be backed up separately using your provider's tools.
:::

::: info Zero Knowledge
The database contains only encrypted metadata and hashed tokens. No plaintext file content or file names are stored on the server. Even with full access to the data directory, an attacker cannot read the uploaded files without the share link.
:::

## Backup Strategy

### Simple Copy

Copy both directories. SQLite with WAL mode supports safe concurrent reads, so you can copy the database while SkySend is running:

```bash
cp -r ./data ./data-backup-$(date +%Y%m%d)
cp -r ./uploads ./uploads-backup-$(date +%Y%m%d)
```

### Docker Volume

In Docker both volumes are mounted from the host:

```yaml
volumes:
  - ./data:/data
  - ./uploads:/uploads
```

Back up both host-side directories.

## Restore

To restore from a backup:

1. Stop SkySend
2. Replace the data directory with the backup
3. Start SkySend

```bash
docker compose down
rm -rf ./data ./uploads
cp -r ./data-backup-20250101 ./data
cp -r ./uploads-backup-20250101 ./uploads
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
