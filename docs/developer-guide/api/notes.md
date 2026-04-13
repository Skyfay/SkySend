# Notes API

Encrypted notes (text, passwords, code snippets, Markdown, SSH keys) are stored in the database - not on the filesystem. Each note has a view counter instead of a download counter, and content is returned inline (not streamed).

## POST /api/note

Create a new encrypted note.

### Request

**Body:**

```json
{
  "encryptedContent": "<base64 encoded ciphertext>",
  "nonce": "<base64 encoded 12-byte IV>",
  "salt": "<base64url encoded 16-byte salt>",
  "ownerToken": "<base64url encoded owner token>",
  "authToken": "<base64url encoded auth token>",
  "contentType": "text",
  "maxViews": 1,
  "expireSec": 3600,
  "hasPassword": false
}
```

| Field | Type | Description |
| --- | --- | --- |
| `encryptedContent` | base64 | AES-256-GCM ciphertext of the note content |
| `nonce` | base64 | 12-byte IV for AES-GCM |
| `salt` | base64url | 16-byte HKDF salt |
| `ownerToken` | base64url | Ownership token (HKDF-derived) |
| `authToken` | base64url | Authentication token (HMAC-derived) |
| `contentType` | string | `"text"`, `"password"`, `"code"`, `"markdown"`, or `"sshkey"` |
| `maxViews` | integer | Maximum number of views (must be a valid option) |
| `expireSec` | integer | Expiry time in seconds (must be a valid option) |
| `hasPassword` | boolean | Whether the note is password-protected |
| `passwordSalt` | base64url | Password KDF salt (required if `hasPassword`) |
| `passwordAlgo` | string | `"argon2id"` or `"pbkdf2"` (required if `hasPassword`) |

### Validation

- `salt` must decode to exactly 16 bytes
- `nonce` must decode to exactly 12 bytes
- Decoded `encryptedContent` must not exceed `NOTE_MAX_SIZE` + 256 bytes (GCM overhead)
- `expireSec` must be one of the configured `NOTE_EXPIRE_OPTIONS_SEC`
- `maxViews` must be one of the configured `NOTE_VIEW_OPTIONS`
- If `hasPassword` is true, `passwordSalt` (16 bytes) and `passwordAlgo` are required

### Response

**201 Created:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "expiresAt": "2026-04-14T12:00:00.000Z"
}
```

**400 Bad Request:**

```json
{
  "error": "Invalid request",
  "details": { ... }
}
```

**413 Payload Too Large:**

```json
{
  "error": "Note content exceeds maximum size"
}
```

---

## GET /api/note/:id

Get note info (without the encrypted content).

### Response

**200 OK:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "contentType": "text",
  "hasPassword": false,
  "salt": "<base64url>",
  "maxViews": 1,
  "viewCount": 0,
  "expiresAt": "2026-04-14T12:00:00.000Z",
  "createdAt": "2026-04-13T12:00:00.000Z"
}
```

Password-protected notes additionally include:

```json
{
  "passwordAlgo": "argon2id",
  "passwordSalt": "<base64url>"
}
```

**404 Not Found:**

```json
{
  "error": "Note not found"
}
```

**410 Gone:**

```json
{
  "error": "Note has expired"
}
```

### Notes

- The encrypted content is never returned by this endpoint
- Returns `410` if the note has expired or reached its view limit

---

## POST /api/note/:id/view

View a note. This atomically increments the view counter and returns the encrypted content.

### Request

**Body:**

```json
{
  "authToken": "<base64url encoded auth token>"
}
```

### Response

**200 OK:**

```json
{
  "encryptedContent": "<base64 encoded ciphertext>",
  "nonce": "<base64 encoded IV>",
  "viewCount": 1,
  "maxViews": 1
}
```

**401 Unauthorized:**

```json
{
  "error": "Invalid auth token"
}
```

**410 Gone:**

```json
{
  "error": "View limit reached"
}
```

### Notes

- The view counter is incremented atomically using a race-proof `WHERE viewCount < maxViews` clause
- If `viewCount` reaches `maxViews`, subsequent requests return `410`
- For burn-after-reading notes (`maxViews: 1`), this is the only chance to read the content
- Auth token comparison uses constant-time comparison to prevent timing attacks

---

## POST /api/note/:id/password

Verify a password for a password-protected note.

### Request

**Body:**

```json
{
  "authToken": "<base64url encoded auth token>"
}
```

### Response

**200 OK** (password is correct):

```json
{
  "ok": true
}
```

**400 Bad Request** (note is not password-protected):

```json
{
  "error": "Note is not password-protected"
}
```

**401 Unauthorized** (incorrect password):

```json
{
  "error": "Invalid password"
}
```

**410 Gone:**

```json
{
  "error": "Note has expired"
}
```

### Notes

- Does not increment the view counter
- Uses constant-time comparison for token verification

---

## DELETE /api/note/:id

Delete a note. Requires the owner token.

### Request

**Headers:**

| Header | Type | Description |
| --- | --- | --- |
| `X-Owner-Token` | base64url | Ownership token |

### Response

**200 OK:**

```json
{
  "ok": true
}
```

**401 Unauthorized:**

```json
{
  "error": "Invalid owner token"
}
```

**404 Not Found:**

```json
{
  "error": "Note not found"
}
```

### Notes

- Notes are stored only in the database - no filesystem cleanup is needed
- After deletion, the note ID returns `404` on all endpoints

### Example

```bash
curl -X DELETE \
  -H "X-Owner-Token: dGVzdA" \
  http://localhost:3000/api/note/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```
