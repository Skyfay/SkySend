# CLI Commands

Detailed reference for all SkySend CLI commands.

## list

Show active uploads on the server.

```bash
skysend-cli list [options]
```

### Options

| Flag | Description |
| --- | --- |
| `--all` | Include expired and exhausted uploads |
| `--json` | Output as JSON (excludes sensitive fields) |

### Output

```
ID                                   Size      Files  DLs    Expires      Created
─────────────────────────────────────────────────────────────────────────────────────
a1b2c3d4-e5f6-7890-abcd-ef1234567890  15.2 MB   1     0/10   in 23h 45m   2 hours ago
b2c3d4e5-f6a7-8901-bcde-f12345678901  1.3 GB    5     3/5    in 6d 12h    1 day ago
```

By default, only active uploads are shown (not expired, download limit not reached). Use `--all` to include all uploads.

### JSON Output

```bash
skysend-cli list --json
```

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "size": 15925248,
    "fileCount": 1,
    "downloadCount": 0,
    "maxDownloads": 10,
    "expiresAt": "2025-01-02T00:00:00.000Z",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
]
```

Sensitive fields (`salt`, `encryptedMeta`, `nonce`, `passwordSalt`) are excluded from JSON output.

## delete

Delete a specific upload by ID.

```bash
skysend-cli delete <id>
```

### Example

```bash
skysend-cli delete a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

```
Deleted upload a1b2c3d4-e5f6-7890-abcd-ef1234567890 (15.2 MB, 1 file)
```

This removes both the database record and the encrypted file from disk. The upload ID must be a valid UUID.

## stats

Show a storage overview with aggregate statistics.

```bash
skysend-cli stats [options]
```

### Options

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON |

### Output

```
SkySend Storage Statistics
──────────────────────────
Total uploads:     42
Total size:        8.5 GB
Total downloads:   156

Active uploads:    35
Active size:       7.2 GB

Expired uploads:   7
Expired size:      1.3 GB
```

## cleanup

Remove expired uploads from the database and disk.

```bash
skysend-cli cleanup [options]
```

### Options

| Flag | Description |
| --- | --- |
| `--dry-run` | Preview what would be removed without deleting |

### Dry Run

```bash
skysend-cli cleanup --dry-run
```

```
Dry run - the following uploads would be removed:
  c3d4e5f6-a7b8-9012-cdef-123456789012  (500 MB, expired)
  d4e5f6a7-b8c9-0123-defa-234567890123  (2.1 GB, limit reached)

2 uploads would be removed (2.6 GB)
```

### Normal Run

```bash
skysend-cli cleanup
```

```
Cleaned up 2 uploads (2.6 GB)
```

Cleanup removes uploads where:
- The expiry time has passed (`expiresAt <= now`)
- The download limit has been reached (`downloadCount >= maxDownloads`)

## config

Show the current server configuration.

```bash
skysend-cli config [options]
```

### Options

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON |

### Output

```
SkySend Configuration
─────────────────────
Port:               3000
Host:               0.0.0.0
Base URL:           http://localhost:3000
Data directory:     ./data

Max file size:      2 GB
Max files/upload:   32
Expire options:     5m, 1h, 1d, 7d
Default expiry:     1d
Download options:   1, 2, 3, 4, 5, 10, 20, 50, 100
Default downloads:  1

Rate limit:         60 req / 60s
Upload quota:       disabled
Cleanup interval:   60s
Site title:         SkySend
```
