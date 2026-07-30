# Server

Hono API on Node 24, Drizzle ORM over better-sqlite3, ESM throughout. Also serves the built SPA from `apps/web/dist` in production. Package name `@skysend/server`.

Relative imports need the `.js` extension (`./lib/config.js`) - the build is `tsc` to ESM with no bundler.

## What the server is allowed to know

The server is deliberately blind. It stores and returns:

- an opaque upload/note ID
- the ciphertext blob and the HKDF salt
- `authToken` and `ownerToken` (both derived, neither reverses to the secret)
- encrypted metadata plus its nonce
- counters and expiry timestamps

It never sees the secret, any derived key, the filename, the MIME type, or note content. Every new field on `uploads` or `notes` must be checked against that list before it is added. A convenience field that leaks a plaintext filename is a product bug, not a feature.

## Layout

```
src/index.ts          Composition root: config, DB, storage, middleware order, routes, shutdown
src/lib/config.ts     Zod schema for every env var + cross-field validation
src/lib/cleanup.ts    Periodic expiry sweep, also exported for the admin CLI
src/lib/password-lockout.ts   Failed-attempt tracking, shared by password and note routes
src/lib/upload-validation.ts  Zod schema + limit checks shared by the HTTP and WS upload paths
src/db/               Drizzle schema, connection, generated migrations
src/routes/           One file per endpoint group
src/middleware/       auth, oidc-guard, quota, rate-limit, branding
src/storage/          StorageBackend interface + filesystem and S3 implementations
src/auth/             OIDC adapters, discovery, PKCE, JWT sessions
```

`src/index.ts` is wiring only. Business logic belongs in a route or a `lib/` module, never inline in the composition root.

## Routes

| Endpoint | Auth | Purpose |
| :--- | :--- | :--- |
| `GET /api/config` | none | Public config for the SPA and the CLI |
| `GET /api/health` | none | Docker healthcheck, CORS open to `*` |
| `GET /api/info/:id` | none | Public upload info, no tokens or storage path |
| `GET /api/exists/:id` | none | Lightweight availability check |
| `POST /api/upload/init`, `/:id/chunk`, `/:id/finalize` | upload session | Chunked HTTP upload |
| `POST /api/upload` | header tokens | Single-request upload, legacy fallback |
| `GET /api/upload/ws` | upload session | WebSocket upload, primary path when `FILE_UPLOAD_WS=true` |
| `POST /api/meta/:id` | owner token | Store encrypted metadata |
| `GET /api/download/:id` | auth token | Stream ciphertext or hand out a presigned S3 URL |
| `POST /api/password/:id` | auth token | Password check, rate limited by lockout |
| `DELETE /api/upload/:id` | owner token | Delete blob and row |
| `GET /api/quota` | none | Remaining upload quota for the caller |
| `POST /api/note`, `POST /api/note/:id` | auth token | Create and view encrypted notes |
| `GET /auth/login\|callback\|logout\|session` | - | OIDC, mounted outside `/api` so redirects avoid CORS |

Service gating: `/info`, `/exists`, `/password`, `/meta`, `/download`, `/upload`, `/quota` are behind a `file` guard and `/note/*` behind a `note` guard, both driven by `ENABLED_SERVICES`. A new route in either family needs the matching guard registered in `src/index.ts`.

## Authentication and tokens

Two token types, both compared in constant time via `constantTimeEqual` from `@skysend/crypto`:

| Token | Header | Grants | Middleware |
| :--- | :--- | :--- | :--- |
| `authToken` | `X-Auth-Token` | Read - download, view a note, password check | `authMiddleware` |
| `ownerToken` | `X-Owner-Token` | Write - store metadata, delete | `ownerMiddleware` |

Both middlewares load the row, verify the token, and put the record in `c.var.upload`. Never compare tokens with `===`, never look a row up by token, and never return either token in a response body.

OIDC is optional and orthogonal: it gates *who may create* uploads and notes (`OIDC_PROTECT_FILES`, `OIDC_PROTECT_NOTES`), not who may read a link. `createOidcGuard` accepts the `skysend-auth` cookie or an `Authorization: Bearer` token so the CLI works too. Sessions are HS256 JWTs signed with `OIDC_SESSION_SECRET` (`src/auth/session.ts`), and login uses PKCE. Provider presets live in `src/auth/adapters/`: `generic`, `pocketid`, `authentik`, `keycloak`.

Discovery is lazy with caching. A provider that is unreachable at startup must not stop the server from booting - keep that property when touching `src/routes/auth.ts`.

## Configuration

Every environment variable is declared in `src/lib/config.ts` as a Zod field, including its default. Env values arrive as strings, so parse with `.transform(...).pipe(z.number()...)` rather than trusting the input. Empty strings are stripped before parsing and treated as unset.

Relationships between variables go into the cross-field block at the end of `loadConfig()`, which already covers file and note option consistency, the S3 requirement set, and OIDC completeness. Fail loudly with a `throw` for a broken configuration, `console.warn` for a risky but workable one.

Adding a variable means four edits: `config.ts`, `.env.example`, `docs/user-guide/configuration/environment-variables.md`, and - if the SPA needs it - the `/api/config` payload in `src/routes/config.ts` plus its Zod schema in `apps/web/src/lib/api.ts`.

`loadConfig()` caches. Call it once in `src/index.ts`, use `getConfig()` everywhere else.

## Database

Drizzle over better-sqlite3. Tables: `uploads`, `notes`, `quota_usage`, `quota_state` (`src/db/schema.ts`).

`initDatabase(dataDir)` creates `<dataDir>/db/skysend.db`, applies the WAL, `busy_timeout`, `synchronous=NORMAL`, and `foreign_keys` pragmas, then runs pending migrations automatically. WAL mode is verified and a failure throws - do not soften that check.

Schema changes:

1. Edit `src/db/schema.ts`.
2. `pnpm --filter @skysend/server db:generate` to emit a migration into `src/db/migrations/`.
3. Commit the generated SQL and the `meta/` snapshot together with the schema change.

Never hand-edit a generated migration, and never rely on `db:migrate` at deploy time - startup applies migrations itself. `pnpm --filter @skysend/server build` copies the migrations folder into `dist/`, so a new migration only ships if that build step ran.

Use the Drizzle query builder. Raw SQL needs a comment explaining why.

## Storage

`StorageBackend` in `src/storage/types.ts` is the contract: `init`, `save`, `createEmpty`, `appendChunk`, `finalizeChunkedUpload`, `createReadStream`, `delete`, `exists`, `size`, `clear`, `supportsPresignedUrls`, `getPresignedDownloadUrl`, `abortChunkedUpload`.

`createStorage(config)` returns `FileStorage` or, for `STORAGE_BACKEND=s3`, dynamically imports `S3Storage` so the AWS SDK stays out of the filesystem deployment. Keep that dynamic import.

Rules:

- IDs come from `randomUUID()`. Never build a storage path from user input - path traversal is the obvious attack here.
- S3 uploads are multipart. A failed or abandoned upload must call `abortChunkedUpload` so parts are not billed forever.
- S3 downloads prefer a presigned URL, which means the browser talks to the bucket directly. The bucket's CORS policy has to allow the instance origin, and `src/index.ts` widens the CSP `connect-src` accordingly.
- A new backend implements the full interface. Returning `false` from `supportsPresignedUrls()` is a valid answer, silently no-op'ing a method is not.

## Uploads

Three transports, one validation path. All of them parse through `uploadHeadersSchema` and `validateUploadHeaders` in `src/lib/upload-validation.ts` - keep it that way, a check added to only one transport is a hole.

**Chunked HTTP** (`src/routes/upload.ts`): `POST /init` opens an in-memory session, chunks arrive at `POST /:id/chunk?index=N` possibly out of order, the route buffers them (50 MB cap per session) and serializes writes through a promise chain so `appendChunk` is never concurrent. `POST /:id/finalize` commits the row. Sessions expire after one hour and are swept every ten minutes.

**Single-request HTTP** (`POST /api/upload`): streams one body straight to storage. Legacy, still kept as a simple fallback.

**WebSocket** (`src/routes/upload-ws.ts`): the primary path when `FILE_UPLOAD_WS=true`. Registered only when the flag and the `file` service are both on, and it validates the `Origin` header itself as defence in depth. An empty origin is allowed on purpose so the CLI and curl still work - the comment at that check explains it.

Chunk requests are intentionally exempt from the global rate limiter - the reasoning is written out at the exemption in `src/index.ts`. Read it before changing that condition. Quota, session validity, and per-session memory caps are what bound chunk traffic.

## Rate limiting, quota, and lockout

- **Rate limiter** (`middleware/rate-limit.ts`): in-memory sliding window keyed by client IP, `RATE_LIMIT_WINDOW` / `RATE_LIMIT_MAX`, emits `X-RateLimit-*` headers. Also applied to `/auth/*`. `getClientIp` honours `TRUST_PROXY` - only trust forwarded headers when the operator opted in.
- **Quota** (`middleware/quota.ts`): per-IP byte budget over `FILE_UPLOAD_QUOTA_WINDOW`, disabled when `FILE_UPLOAD_QUOTA_BYTES=0`. IPs are HMAC-hashed with a key that rotates every 24 hours, and state is persisted in `quota_state` so restarts do not reset budgets. Never store or log a raw IP here.
- **Password lockout** (`lib/password-lockout.ts`): one shared instance for the password and note routes, `PASSWORD_MAX_ATTEMPTS` failures lock a resource for `PASSWORD_LOCKOUT_MS`.

## Security headers and middleware order

`src/index.ts` sets a strict CSP through `secureHeaders`. Several directives carry a comment explaining exactly why they are as loose as they are (`wasm-unsafe-eval` for hash-wasm, `unsafe-inline` styles for two computed style props, `connect-src` for S3, `form-action` for the OIDC issuer, `img-src` for an external `CUSTOM_LOGO`). Widening any of them means updating that comment with the new reason, or better, removing the need.

Order matters and is easy to break:

1. `logger`, `secureHeaders`, CORS (health first with `*`, then the allowlist from `BASE_URL` + `CORS_ORIGINS`)
2. `app.onError` - returns a generic message with `Cache-Control: no-store`
3. `/api` group: `no-store` on every response, then the rate limiter with its chunk and WS exemptions
4. Service guards, then the routes
5. `/branding/*`, `/assets/*` (immutable caching), the SPA fallback, then the catch-all static handler

The SPA fallback must stay ahead of the catch-all `serveStatic`, otherwise `GET /` bypasses the `__CUSTOM_TITLE__` injection. Error responses and `index.html` are `no-store` on purpose - the comments explain the caching-proxy failure they prevent.

Node timeouts at the bottom of the file (`headersTimeout` 60 s, `requestTimeout` 0, `keepAliveTimeout` 120 s) are tuned for slow multi-hour uploads behind a proxy. Each one has a comment. Do not "clean them up".

## Logging

`console.log` / `warn` / `error` with a bracketed prefix (`[storage]`, `[quota]`, `[oidc]`, `[skysend]`) is the house style here - there is no logger abstraction, and adding one is not on the roadmap.

What must never be logged: secrets, derived keys, auth or owner tokens, request bodies, filenames, note content, raw IP addresses. The Hono request logger records method, path, status, and duration only, and that comment in `src/index.ts` is a deliberate audit note.

Errors returned to the client stay generic. Details go to the log, not the response.

## Tests

Vitest, files in `apps/server/tests/`, run with `pnpm --filter @skysend/server test`. Coverage config in `vitest.config.ts` excludes `src/index.ts`, the type-only files, and the S3 backend.

- Tests run against a real temporary SQLite database, not a mock.
- New route: cover the happy path, a rejected invalid token, and the boundary that the Zod schema enforces.
- Security-relevant behavior gets a test that fails against the old code - constant-time comparison, lockout counting, quota accounting, origin checks.
- Never assert on log output. Assert on status codes, response bodies, and persisted rows.
