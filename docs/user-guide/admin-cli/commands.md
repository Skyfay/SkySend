# CLI Commands

Detailed reference for all SkySend CLI commands.

## list

Show active uploads, notes and file requests on the server.

```bash
skysend-cli list [options]
```

### Options

| Flag | Description |
| --- | --- |
| `--all` | Include expired and exhausted uploads and notes, and file requests that are over and empty |
| `--json` | Output as JSON (excludes sensitive fields) |

### Output

Uploads, notes and file requests each get a table of their own:

```
File requests
ID                                    Uploads  Received  Max/Upload  Kept        Closes   Created
------------------------------------  -------  --------  ----------  ----------  -------  -------------------
aa197437-0205-47c4-8d72-37b195c5be76  1/2      4.9 KB    1.0 MB      1 (4.9 KB)  23h 59m  2026-10-06 22:00:40
1 file request(s)
```

| Column | Meaning |
| --- | --- |
| Uploads | Finished uploads of the allowed ones. A deleted upload keeps its slot. |
| Received | Bytes of the finished uploads, deleted ones included |
| Max/Upload | The most bytes one upload may have |
| Kept | Uploads still stored, and their size |
| Closes | Time until the request stops taking uploads, `expired` once that time has passed, or `closed` |

By default only active entries are shown: uploads and notes that are neither expired nor used up, and file requests that still take uploads or still hold some. Use `--all` to include everything.

### JSON Output

```bash
skysend-cli list --json
```

```json
{
  "uploads": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "size": 15925248,
      "fileCount": 1,
      "hasPassword": false,
      "passwordAlgo": null,
      "maxDownloads": 10,
      "downloadCount": 0,
      "expiresAt": "2026-10-07T00:00:00.000Z",
      "createdAt": "2026-10-06T00:00:00.000Z",
      "storagePath": "a1b2c3d4-e5f6-7890-abcd-ef1234567890.bin",
      "type": "upload"
    }
  ],
  "notes": [],
  "requests": [
    {
      "id": "aa197437-0205-47c4-8d72-37b195c5be76",
      "hasPassword": false,
      "closed": false,
      "maxUploads": 2,
      "maxSize": 1048576,
      "finishedUploads": 1,
      "finishedBytes": 5032,
      "closesAt": "2026-10-07T22:00:40.000Z",
      "createdAt": "2026-10-06T22:00:40.000Z",
      "uploads": [
        {
          "id": "0b5a4f8e-9a3c-4d1e-8f2b-6c7d8e9f0a1b",
          "size": 5032,
          "fileCount": 1,
          "downloadCount": 0,
          "maxDownloads": 5,
          "expiresAt": "2026-10-13T22:00:40.000Z",
          "createdAt": "2026-10-06T22:00:40.000Z"
        }
      ]
    }
  ]
}
```

Sensitive fields are excluded from JSON output: `salt`, `encryptedMeta`, `nonce`, `passwordSalt` and both tokens of uploads and notes, and of file requests the vault, all three tokens, the encrypted title and the wrapped file keys.

## delete

Delete an upload, a note, a file request or one upload inside a file request, by ID.

```bash
skysend-cli delete <id>
```

### Example

```bash
skysend-cli delete aa197437-0205-47c4-8d72-37b195c5be76
```

```
Deleted file request aa197437-0205-47c4-8d72-37b195c5be76 with 1 upload(s) (4.9 KB)
```

This removes the database records and the encrypted files from disk. Deleting a file request removes every upload in it. The ID must be a valid UUID.

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
Storage Overview
================
Total uploads:    42 (8.5 GB)
Active uploads:   35 (7.2 GB)
Expired uploads:  7
Total downloads:  156

Total notes:      12
Active notes:     9
Expired notes:    3
Total views:      40

File requests:    4
Open requests:    3
Request uploads:  1 (4.9 KB)
Their downloads:  0
```

## cleanup

Remove expired uploads, notes and files of file requests, and file requests that are over and empty, from the database and disk.

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
Would remove 2 upload(s):
  c3d4e5f6-a7b8-9012-cdef-123456789012 (500.0 MB, 1 file(s))
  d4e5f6a7-b8c9-0123-defa-234567890123 (2.1 GB, 3 file(s))
Would remove 1 upload(s) from file requests:
  0b5a4f8e-9a3c-4d1e-8f2b-6c7d8e9f0a1b (4.9 KB) in request aa197437-0205-47c4-8d72-37b195c5be76
Total: 2.6 GB
```

### Normal Run

```bash
skysend-cli cleanup
```

```
Cleaned up 3 item(s) (2.6 GB of files)
```

Cleanup removes:
- Uploads and files of file requests whose expiry time has passed or whose downloads are used up
- Notes whose expiry time has passed or whose views are used up
- File requests whose time ran out about 75 minutes ago and that hold no upload any more. The wait lets an upload that started before the request closed still finish. Closing a request by hand does not bring this forward.

The server runs the same cleanup every `CLEANUP_INTERVAL` seconds, so the command is only needed to clean up right away.

## config

Show the current server configuration.

```bash
skysend-cli config [options]
```

### Options

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON, with `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `OIDC_CLIENT_SECRET` and `OIDC_SESSION_SECRET` masked |

### Output

```
Server Configuration
====================
Site Title:         SkySend
Base URL:           http://localhost:3000
Host:               0.0.0.0:3000
Data Directory:     ./data
Enabled Services:   file, note, request

File Settings
-------------
Max File Size:      2.0 GB
Max Files/Upload:   32
Expire Options:     5m, 1h, 1d, 7d
Default Expiry:     1d
Download Options:   1, 2, 3, 4, 5, 10, 20, 50, 100
Default Downloads:  1
Upload Quota:       disabled

Note Settings
-------------
Max Note Size:      1.0 MB
Expire Options:     5m, 1h, 1d, 7d
Default Expiry:     1d
View Options:       ∞, 1, 2, 3, 5, 10, 20, 50, 100
Default Views:      ∞

File Request Settings
---------------------
Open For Options:   1d, 3d, 7d
Default Open For:   3d
Upload Options:     1, 2, 3, 5, 10, 20, 50, 100
Default Uploads:    10
Max Size/Upload:    2.0 GB
Retention:          7d
Download Options:   1, 2, 3, 5, 10, 20
Default Downloads:  5
Daily Limit:        100

General
-------
Cleanup Interval:   60s
Rate Limit:         60 req / 60000ms
```
