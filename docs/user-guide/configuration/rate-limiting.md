# Rate Limiting & Quotas

SkySend includes built-in rate limiting and upload quotas to protect against abuse.

## Rate Limiting

Rate limiting applies to all API endpoints. It uses a sliding window algorithm per IP address.

| Variable | Default | Description |
| --- | --- | --- |
| `RATE_LIMIT_WINDOW` | `60000` | Window size in milliseconds (default: 1 minute) |
| `RATE_LIMIT_MAX` | `60` | Maximum requests per window per IP |

### Response Headers

Every response includes rate limit headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1704067260000
```

When the limit is exceeded, the server returns `429 Too Many Requests`.

### Configuration Examples

```bash
# Strict: 20 requests per minute
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=20

# Relaxed: 200 requests per 5 minutes
RATE_LIMIT_WINDOW=300000
RATE_LIMIT_MAX=200
```

## Upload Quotas

Upload quotas limit the total volume of data a single user can upload within a time window. This prevents a single user from filling up the server's storage.

| Variable | Default | Description |
| --- | --- | --- |
| `UPLOAD_QUOTA_BYTES` | `0` | Maximum bytes per user per window. `0` = disabled |
| `UPLOAD_QUOTA_WINDOW` | `86400` | Window size in seconds (default: 24 hours) |

### Configuration Examples

```bash
# 10 GB per user per day
UPLOAD_QUOTA_BYTES=10737418240
UPLOAD_QUOTA_WINDOW=86400

# 1 GB per user per hour
UPLOAD_QUOTA_BYTES=1073741824
UPLOAD_QUOTA_WINDOW=3600
```

### Privacy

Upload quotas use HMAC-SHA256 to hash IP addresses before storing them. The HMAC key rotates daily, which means:

- No plaintext IP addresses are ever stored
- IP hashes cannot be correlated across days
- When the key rotates, the entire quota store is cleared

This design ensures that SkySend enforces quotas without compromising user privacy.

### Behavior

When a quota is exceeded, the server returns `429 Too Many Requests` with a message indicating when the quota resets:

```json
{
  "error": "Upload quota exceeded",
  "retryAfter": 3600
}
```

## Password Attempt Lockout

SkySend tracks failed password attempts per upload/note and per client IP. After too many failures, that specific IP is locked out from that specific resource for a configurable duration.

This is intentionally per-resource, not per-IP globally: a user mis-typing a password cannot block others from accessing unrelated uploads, and a shared IP (corporate NAT, VPN) cannot trigger a lockout for a resource they have not tried.

| Variable | Default | Description |
| --- | --- | --- |
| `PASSWORD_MAX_ATTEMPTS` | `10` | Failed attempts before lockout |
| `PASSWORD_LOCKOUT_MS` | `900000` | Lockout duration in milliseconds (default: 15 minutes) |

When locked, the server returns `429 Too Many Requests` with a `Retry-After` header indicating the remaining wait in seconds.

### Privacy

Client IP addresses are HMAC-SHA256 hashed with an ephemeral in-memory key before being stored. The key is generated fresh on startup and never persisted or logged - raw IPs are never retained.

### Configuration Examples

```bash
# Stricter: lock after 5 attempts for 30 minutes
PASSWORD_MAX_ATTEMPTS=5
PASSWORD_LOCKOUT_MS=1800000

# More lenient: lock after 20 attempts for 5 minutes
PASSWORD_MAX_ATTEMPTS=20
PASSWORD_LOCKOUT_MS=300000
```

## IP Detection

SkySend determines the client IP using:

1. `X-Forwarded-For` header (if `TRUST_PROXY=true`)
2. `X-Real-IP` header (if `TRUST_PROXY=true`)
3. Direct socket address (fallback)

::: warning
Only enable `TRUST_PROXY=true` when running behind a trusted reverse proxy. Otherwise, clients can spoof their IP to bypass rate limits and quotas.
:::
