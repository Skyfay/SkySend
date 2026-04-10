# Password Verification API

## POST /api/password/:id

Verify a password for a password-protected upload.

### Request

**Body:**

```json
{
  "authToken": "<base64url encoded auth token>"
}
```

The `authToken` is derived client-side from the secret (which itself was recovered using the password). If the password is correct, the derived auth token will match the one stored on the server.

### Response

**200 OK** (password is correct):

```json
{
  "ok": true
}
```

**400 Bad Request** (upload is not password-protected):

```json
{
  "error": "Upload is not password protected"
}
```

**401 Unauthorized** (incorrect password):

```json
{
  "error": "Invalid password"
}
```

**404 Not Found:**

```json
{
  "error": "Upload not found"
}
```

**410 Gone:**

```json
{
  "error": "Upload expired"
}
```

### How Password Verification Works

1. The client retrieves the upload info (`GET /api/info/:id`) which includes `passwordSalt` and `passwordAlgo`
2. The user enters their password
3. The client derives `passwordKey` using the same algorithm (Argon2id or PBKDF2)
4. The client recovers the secret: `secret = protectedSecret XOR passwordKey`
5. The client derives keys and computes the `authToken`
6. The client sends the `authToken` to `POST /api/password/:id`
7. The server compares the provided token with the stored token using constant-time comparison

This approach means the server never receives the password. It only verifies that the client was able to derive the correct authentication token, which proves knowledge of the secret.
