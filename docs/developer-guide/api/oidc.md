# OIDC Authentication

SkySend supports optional OIDC/SSO authentication to restrict who can create uploads and notes. Download and read access always remains public - consistent with the zero-knowledge design.

## Design Principles

- **Upload-only gate** - OIDC protects creation endpoints. Anyone with a share link can still download the encrypted content without an account.
- **Stateless sessions** - No session state is stored in the database. Sessions are HS256 JWTs verified on every guarded request.
- **Two client types** - The browser uses an HttpOnly session cookie. The CLI uses a `Bearer` token in the `Authorization` header.
- **PKCE mandatory** - Every login flow uses PKCE with S256 to prevent authorization code interception attacks.
- **Lazy discovery** - The OIDC provider metadata is fetched once on first use and cached for the lifetime of the process. The server starts normally even if the provider is temporarily unreachable.

## Auth Flow

```
Browser / CLI                  SkySend Server              OIDC Provider
     │                               │                            │
     │  GET /auth/login              │                            │
     │ ─────────────────────────────>│                            │
     │                               │  discovery (cached)        │
     │                               │ ──────────────────────────>│
     │                               │  provider metadata         │
     │                               │ <──────────────────────────│
     │                               │                            │
     │  302  →  provider auth URL    │                            │
     │ <─────────────────────────────│                            │
     │  (PKCE state stored in short-lived JWT cookie, 5 min)      │
     │                               │                            │
     │  User authenticates at provider                            │
     │  provider redirects to /auth/callback?code=...             │
     │ ─────────────────────────────────────────────────────────>│
     │                               │                            │
     │  GET /auth/callback           │                            │
     │ ─────────────────────────────>│                            │
     │                               │  token exchange (PKCE)     │
     │                               │ ──────────────────────────>│
     │                               │  ID token + access token   │
     │                               │ <──────────────────────────│
     │                               │  create session JWT        │
     │  Set-Cookie: skysend-auth=... │                            │
     │ <─────────────────────────────│                            │
     │  302  →  /                    │                            │
```

For CLI clients the flow is identical except the session JWT is delivered as a redirect to `http://localhost:{port}?token=...` (the CLI starts a local server to receive it).

## Auth Endpoints

These routes live outside the `/api` prefix to avoid CORS complications during browser redirects.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/auth/login` | Start PKCE login flow, redirect to provider |
| `GET` | `/auth/callback` | Handle provider callback, issue session cookie |
| `GET` | `/auth/logout` | Clear session cookie, redirect to provider end-session if supported |
| `GET` | `/auth/session` | Return current user info or `401` |

### GET /auth/login

Initiates the OIDC authorization code + PKCE flow.

**Query parameters:**

| Parameter | Required | Description |
| --- | --- | --- |
| `cli_callback` | No | Local callback URL for CLI login (only `http://localhost` or `http://127.0.0.1` accepted) |

**Behavior:**

1. Fetches (or uses cached) provider metadata via OIDC Discovery.
2. Generates a fresh PKCE bundle (`state`, `nonce`, `code_verifier`, `code_challenge`).
3. Stores the PKCE bundle in a short-lived (5 min) HttpOnly JWT cookie (`skysend-pkce`).
4. Redirects the client to the provider authorization URL.

**Error responses:**

| Status | Reason |
| --- | --- |
| `400` | Invalid `cli_callback` (not localhost/127.0.0.1) |
| `503` | Provider unreachable during discovery |

### GET /auth/callback

Handles the redirect from the OIDC provider after authentication.

**Behavior:**

1. Reads and verifies the `skysend-pkce` cookie (signed JWT, 5 min TTL).
2. Exchanges the authorization code for tokens (PKCE code verifier included).
3. Extracts user identity from the ID token claims via the configured adapter.
4. Creates a signed session JWT containing `sub`, `name`, and `email`.
5. If a `cli_callback` was embedded in the PKCE cookie, redirects to `http://localhost:{port}?token=...` (CLI path). Otherwise sets the `skysend-auth` HttpOnly session cookie and redirects to `/`.

**Error responses:**

| Status | Reason |
| --- | --- |
| `400` | Missing/invalid PKCE cookie or token exchange failure |
| `503` | Provider unreachable |

### GET /auth/logout

Clears the session cookie and optionally redirects to the provider's end-session endpoint (if the provider supports it and metadata is cached).

### GET /auth/session

Returns the currently authenticated user or `401`.

**Response (200):**

```json
{
  "sub": "user-id-from-provider",
  "name": "Jane Doe",
  "email": "jane@example.com"
}
```

## OIDC Guard Middleware

The `createOidcGuard` middleware is applied selectively to creation endpoints. It accepts credentials in two ways:

1. `skysend-auth` session cookie (browser)
2. `Authorization: Bearer <token>` header (CLI)

If the token is absent or expired, the middleware returns `401` immediately.

## Protected vs. Public Endpoints

The key design principle: **OIDC only gates creation**. Fetch, info, and download endpoints are always accessible to anyone with a valid share link.

### Always public (no OIDC check)

| Endpoint | Why |
| --- | --- |
| `GET /api/config` | Server limits needed before login |
| `GET /api/health` | Monitoring |
| `GET /api/info/:id` | Lets the browser render the download page without login |
| `GET /api/exists/:id` | Lightweight existence check |
| `GET /api/download/:id` | Encrypted blob - useless without the key in the URL fragment. Still requires a valid **auth token** derived from the E2EE key. |
| `POST /api/password/:id` | Password verification for E2EE-password-protected files |
| `GET /api/note/:id` | Note metadata (type, views, expiry) |
| `POST /api/note/:id/view` | Returns encrypted note content. Requires **auth token** from E2EE key. |
| `POST /api/note/:id/password` | Password verification for notes |

::: info Auth token vs. OIDC session
The `X-Auth-Token` header used for downloads and note views is derived from the E2EE secret key in the URL fragment - it is entirely separate from OIDC. A valid auth token proves the requester knows the encryption key, not who they are.
:::

### Protected when configured

| Endpoint | Condition |
| --- | --- |
| `POST /api/upload` | `OIDC_PROTECT_FILES=true` |
| `POST /api/upload/init` | `OIDC_PROTECT_FILES=true` |
| `WS /api/upload/ws` | `OIDC_PROTECT_FILES=true` |
| `POST /api/note` | `OIDC_PROTECT_NOTES=true` |

Chunk uploads (`POST /api/upload/:id/chunk`) and finalization (`POST /api/upload/:id/finalize`) are **not** individually re-guarded. Once the init step has been authorized, the upload session token acts as the credential for the rest of the sequence.

## Provider Adapters

| Adapter key | Provider | Notes |
| --- | --- | --- |
| `generic` | Any OIDC-compliant provider | Default. Uses standard `name`/`email` claims. |
| `pocketid` | PocketID | Same as generic. |
| `authentik` | Authentik | Maps `name` from `name` claim. |
| `keycloak` | Keycloak | Maps `name` from `preferred_username` if `name` is absent. |

The active adapter is selected via the `OIDC_PROVIDER` env var. All adapters implement the same `OidcAdapterProfile` interface and can be swapped without changing any route or middleware code.

## Session JWT

Sessions are stateless HS256 JWTs signed with `OIDC_SESSION_SECRET`.

**Payload:**

```json
{
  "sub": "provider-subject-id",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "iat": 1715000000,
  "exp": 1715086400
}
```

Session lifetime is configured with `OIDC_SESSION_DURATION` (default: 86400 s / 24 h). There is no refresh - the user must log in again after expiry.

## CLI Login Flow

The CLI client uses a device-browser flow:

1. The CLI starts a temporary HTTP server on a random local port.
2. It opens the browser to `GET /auth/login?cli_callback=http://localhost:{port}/callback`.
3. The user authenticates in the browser as normal.
4. After callback, the server redirects to `http://localhost:{port}/callback?token=<jwt>` instead of setting a cookie.
5. The CLI reads the JWT from the query parameter, stores it in `~/.config/skysend/tokens.json`, and closes the local server.
6. Subsequent CLI requests include the JWT as `Authorization: Bearer <token>`.

Only `http://localhost` and `http://127.0.0.1` are accepted as `cli_callback` values to prevent open redirect attacks.
