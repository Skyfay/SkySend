# Rate Limiting & Quotas

SkySend includes built-in rate limiting and upload quotas to protect against abuse. All variables are documented in the [Environment Variables](/user-guide/configuration/environment-variables) reference.

## Rate Limiting

Rate limiting applies to all API endpoints using a sliding window algorithm per IP address. Controlled via `RATE_LIMIT_WINDOW` (milliseconds) and `RATE_LIMIT_MAX` (requests per window, default: 60 per minute).

Every response includes rate limit headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1704067260000
```

When the limit is exceeded, the server returns `429 Too Many Requests`.

## Upload Quotas

Upload quotas limit the total volume of data a single user can upload within a time window, preventing a single user from filling up the server's storage. Controlled via `FILE_UPLOAD_QUOTA_BYTES` and `FILE_UPLOAD_QUOTA_WINDOW`. Set `FILE_UPLOAD_QUOTA_BYTES=0` to disable quotas (default).

When a quota is exceeded, the server returns `429 Too Many Requests`:

```json
{
  "error": "Upload quota exceeded",
  "retryAfter": 3600
}
```

### Privacy

Upload quotas use HMAC-SHA256 to hash IP addresses before storing them. The HMAC key rotates daily, which means:

- No plaintext IP addresses are ever stored
- IP hashes cannot be correlated across days
- When the key rotates, the entire quota store is cleared

## Password Attempt Lockout

SkySend tracks failed password attempts per upload/note and per client IP. After too many failures, that specific IP is locked out from that specific resource for a configurable duration. Controlled via `PASSWORD_MAX_ATTEMPTS` and `PASSWORD_LOCKOUT_MS`.

This is intentionally per-resource, not per-IP globally: a user mis-typing a password cannot block others from accessing unrelated uploads, and a shared IP (corporate NAT, VPN) cannot trigger a lockout for a resource they have not tried.

When locked, the server returns `429 Too Many Requests` with a `Retry-After` header indicating the remaining wait in seconds.

### Privacy

Client IP addresses are HMAC-SHA256 hashed with an ephemeral in-memory key before being stored. The key is generated fresh on startup and never persisted or logged - raw IPs are never retained.

## IP Detection

SkySend determines the client IP using:

1. `X-Forwarded-For` header (if `TRUST_PROXY=true`)
2. `X-Real-IP` header (if `TRUST_PROXY=true`)
3. Direct socket address (fallback)

::: warning
Only enable `TRUST_PROXY=true` when running behind a trusted reverse proxy. Otherwise, clients can spoof their IP to bypass rate limits and quotas.
:::
