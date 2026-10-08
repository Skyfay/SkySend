# Rate Limiting & Quotas

SkySend includes built-in rate limiting and upload quotas to protect against abuse. All variables are documented in the [Environment Variables](/user-guide/configuration/environment-variables) reference.

Every limit on this page counts per client address. An IPv6 client counts per /64 network, since a household, a phone or a server usually holds a whole /64 and could otherwise take a new address for every request. An IPv4 address that arrives mapped into IPv6 counts as that IPv4 address.

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

An upload reserves its size in the quota when it starts and keeps it until it is stored or ends, so uploads running side by side cannot add up to more than the quota. An upload that fails or is cancelled gives its share back. Uploads into a [file request](/user-guide/file-requests) count against the quota of the sender.

When the quota is used up, the server returns `429 Too Many Requests`:

```json
{
  "error": "Upload quota exceeded. Try again later."
}
```

An upload that would not fit into what is left of the quota gets `413 Content Too Large` with `"File size exceeds remaining quota."`.

### Privacy

Upload quotas use HMAC-SHA256 to hash IP addresses before storing them. The HMAC key rotates daily, which means:

- No plaintext IP addresses are ever stored
- IP hashes cannot be correlated across days
- When the key rotates, the entire quota store is cleared

## Daily File Request Limit

`FILE_REQUEST_DAILY_LIMIT` caps how many file requests one person creates per day. It counts the OIDC user when `OIDC_PROTECT_FILES` puts creating behind the login, and the client IP otherwise. The day starts with the first request of that user or IP. Set it to `0` to disable the limit (default).

A request costs little by itself, but every one is an inbox that anyone with its link can fill. On a public instance, set the limit together with [Upload Quotas](#upload-quotas), for example `FILE_REQUEST_DAILY_LIMIT=100`. Behind a reverse proxy, the limit needs `TRUST_PROXY=true`, or everyone shares the count of the proxy's IP.

When the limit is used up, creating a request returns `429 Too Many Requests`, and the request form says when the next one is possible. The count lives in memory, with the IP HMAC-hashed by a key that is never stored, so a restart resets it.

## Password Attempt Lockout

SkySend tracks failed password attempts per upload/note and per client IP. For an upload, the password check and a download with a wrong token count together, so a guesser cannot switch between them. After too many failures, that specific IP is locked out from that specific resource for a configurable duration. Controlled via `PASSWORD_MAX_ATTEMPTS` and `PASSWORD_LOCKOUT_MS`.

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
