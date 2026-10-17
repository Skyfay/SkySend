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
src/lib/index-html.ts Runtime placeholders in the SPA's index.html (title, theme, link preview tags)
src/lib/cleanup.ts    Periodic expiry sweep, also exported for the admin CLI
src/lib/password-lockout.ts   Failed-attempt tracking, shared by the password, note and inbox routes
src/lib/upload-validation.ts  Zod schema + limit checks shared by the HTTP and WS upload paths
src/lib/chunked-upload.ts     Session layer of chunked HTTP uploads, shared by uploads and file requests
src/lib/ws-upload.ts          Session layer of WebSocket uploads, shared by uploads and file requests
src/lib/request-validation.ts Strict base64url fields and token headers of the file request routes
src/lib/request-limit.ts      In-memory daily limit for creating file requests
src/lib/slot-holds.ts         In-memory hold of the second slot of a submission of files and a note
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
| `GET /api/info/:id` | none | Public upload info, no tokens or storage path, and no metadata of a password-protected upload |
| `GET /api/exists/:id` | none | Lightweight availability check |
| `POST /api/upload/init`, `/:id/chunk`, `/:id/finalize` | upload session | Chunked HTTP upload |
| `POST /api/upload` | header tokens | Single-request upload, legacy fallback |
| `GET /api/upload/ws` | upload session | WebSocket upload, primary path when `FILE_UPLOAD_WS=true` |
| `POST /api/meta/:id` | owner token | Store encrypted metadata, once: the update only runs while none is stored, since the owner token comes from the link |
| `GET /api/download/:id` | auth token | Stream ciphertext or hand out a presigned S3 URL |
| `POST /api/password/:id` | auth token | Password check, rate limited by lockout, returns the metadata of a password-protected upload. `410` for an expired or used-up share, like the info |
| `DELETE /api/upload/:id` | owner token | Delete blob and row |
| `GET /api/quota` | none | Remaining upload quota for the caller |
| `POST /api/note`, `POST /api/note/:id` | auth token | Create and view encrypted notes |
| `POST /api/request` | OIDC when `OIDC_PROTECT_REQUESTS` | Create a file request, daily limit per user or IP |
| `GET /api/request/limit` | OIDC when `OIDC_PROTECT_REQUESTS` | How many new requests the caller has left today, without counting one |
| `GET /api/request/:id` | `X-Upload-Token` | What a sender sees: encrypted title, uploads left, size of one upload |
| `GET /api/request/:id/upload/ws` | upload token in the init frame | WebSocket upload into a request, primary path when `FILE_UPLOAD_WS=true` |
| `POST /api/request/:id/upload/init`, `/:uid/chunk`, `/:uid/finalize` | `X-Upload-Token` at init | Chunked HTTP upload into a request, the fallback |
| `DELETE /api/request/:id/upload/:uid` | upload session | A cancelled upload gives its slot back at once |
| `GET /api/inbox/:id`, `GET /api/inbox/:id/file/:uid` | `X-Inbox-Token` | Vault and uploads, download one file |
| `DELETE /api/inbox/:id/file/:uid`, `POST /api/inbox/:id/close`, `DELETE /api/inbox/:id` | `X-Inbox-Owner-Token` | Manage a request |
| `GET /auth/login\|callback\|logout\|session` | - | OIDC, mounted outside `/api` so redirects avoid CORS |

Service gating: `/info`, `/exists`, `/password`, `/meta`, `/download`, `/upload`, `/quota` are behind a `file` guard and `/note/*` behind a `note` guard, both driven by `ENABLED_SERVICES`. A new route in either family needs the matching guard registered in `src/index.ts`. The two file request routes are the exception: `createRequestRoute` and `createInboxRoute` register the `request` guard themselves and take the OIDC guard and the quota as options, so the tests mount exactly what production runs. Keep it that way for routes added to that family.

`/api/config` lists `file` and `note` in `enabledServices` and reports file requests as `fileRequestsEnabled`. Released CLI clients refuse a config whose `enabledServices` holds anything else, so a new service gets a field of its own there too.

## Authentication and tokens

Two token types, both compared in constant time via `constantTimeEqual` from `@skysend/crypto`:

| Token | Header | Grants | Middleware |
| :--- | :--- | :--- | :--- |
| `authToken` | `X-Auth-Token` | Read - download, view a note, password check | `authMiddleware` |
| `ownerToken` | `X-Owner-Token` | Write - store metadata, delete | `ownerMiddleware` |

Both middlewares load the row, verify the token, and put the record in `c.var.upload`. Never compare tokens with `===`, never look a row up by token, and never return either token in a response body.

OIDC is optional and orthogonal: it gates *who may create* uploads, notes and file requests (`OIDC_PROTECT_FILES`, `OIDC_PROTECT_NOTES`, `OIDC_PROTECT_REQUESTS`), not who may read a link. Unset, `OIDC_PROTECT_REQUESTS` follows the other two and is on while either one is. `createOidcGuard` accepts the `skysend-auth` cookie or an `Authorization: Bearer` token so the CLI works too. Sessions are HS256 JWTs signed with `OIDC_SESSION_SECRET` (`src/auth/session.ts`), and login uses PKCE. Provider presets live in `src/auth/adapters/`: `generic`, `pocketid`, `authentik`, `keycloak`.

Every `/auth` response is `no-store`, since `/auth/session` returns the user and the CLI callback carries a session token in its redirect.

Discovery is lazy with caching. A provider that is unreachable at startup must not stop the server from booting - keep that property when touching `src/routes/auth.ts`.

## Configuration

Every environment variable is declared in `src/lib/config.ts` as a Zod field, including its default. Env values arrive as strings, so parse with `.transform(...).pipe(z.number()...)` rather than trusting the input. Empty strings are stripped before parsing and treated as unset.

Relationships between variables go into the cross-field block at the end of `loadConfig()`, which already covers file and note option consistency, the S3 requirement set, and OIDC completeness. Fail loudly with a `throw` for a broken configuration, `console.warn` for a risky but workable one.

Adding a variable means five edits: `config.ts`, `.env.example`, `.env.dev.example` (commented out with its default unless dev needs another value), `docs/user-guide/configuration/environment-variables.md`, and - if the SPA needs it - the `/api/config` payload in `src/routes/config.ts` plus its Zod schema in `apps/web/src/lib/api.ts`.

`loadConfig()` caches. Call it once in `src/index.ts`, use `getConfig()` everywhere else.

## Database

Drizzle over better-sqlite3. Tables: `uploads`, `notes`, `quota_usage`, `quota_state`, `file_requests`, `request_uploads` (`src/db/schema.ts`).

Files uploaded into a request live in `request_uploads`, never in `uploads`, so no route of a normal upload can serve one. `file_requests` keeps two pairs of counters: `reserved_*` counts running and finished uploads and is set back to `finished_*` at startup, because no session survives a restart. The first part of a submission of files and a note reserves two slots, and `lib/slot-holds.ts` keeps the second one in memory for 30 minutes under a token its finalize returns, so the note always finds its slot. `finished_*` never goes down, so a deleted upload keeps its slot. Deleting a request goes through `deleteFileRequest` in `lib/cleanup.ts`, which removes the rows before the blobs so a finishing upload cannot leave one behind.

`initDatabase(dataDir)` creates `<dataDir>/db/skysend.db`, applies the WAL, `busy_timeout`, `synchronous=NORMAL`, and `foreign_keys` pragmas, then runs pending migrations automatically. WAL mode is verified and a failure throws - do not soften that check.

Schema changes:

1. Edit `src/db/schema.ts`.
2. `pnpm --filter @skysend/server db:generate` to emit a migration into `src/db/migrations/`.
3. Commit the generated SQL and the `meta/` snapshot together with the schema change.

Never hand-edit a generated migration, and never rely on `db:migrate` at deploy time - startup applies migrations itself. `pnpm --filter @skysend/server build` copies the migrations folder into `dist/`, so a new migration only ships if that build step ran.

Use the Drizzle query builder. Raw SQL needs a comment explaining why.

## Storage

`StorageBackend` in `src/storage/types.ts` is the contract: `init`, `save` (with the declared size when there is one), `createEmpty`, `appendChunk`, `finalizeChunkedUpload`, `createReadStream`, `delete`, `exists`, `size`, `clear`, `supportsPresignedUrls`, `getPresignedDownloadUrl`, `abortChunkedUpload`.

`createStorage(config)` returns `FileStorage` or, for `STORAGE_BACKEND=s3`, dynamically imports `S3Storage` so the AWS SDK stays out of the filesystem deployment. Keep that dynamic import.

Rules:

- IDs come from `randomUUID()`. Never build a storage path from user input - path traversal is the obvious attack here.
- S3 uploads are multipart. A failed or abandoned upload must call `abortChunkedUpload` so parts are not billed forever. `createEmpty(id, size)` gets the declared size: an upload that fits into one part is stored with one PutObject, and the part size grows so no upload needs more than 10,000 parts.
- The S3 client sends no `Expect: 100-continue` (`expectContinueHeader: false`). With it, the AWS SDK opens a new connection without keep-alive for every body over 2 MB, so each part paid a DNS lookup and a TLS handshake. On a dev machine whose resolver held some of several parallel lookups back by 2.5 s, that kept uploads to R2 at 10 MiB/s, and 54 MiB/s without it (2026-10-13). With a resolver that answers at once the two were within noise of each other. Keep it off.
- All S3 uploads together hold at most `S3_MEMORY_LIMIT` bytes in parts on their way to the bucket (`PartMemory` in `s3.ts`). Its default, like the one of `FILE_UPLOAD_WS_MEMORY_LIMIT`, is `defaultMemoryBudget()` in `config.ts`: a quarter of what the process may use, the container limit from `process.constrainedMemory()` before the RAM of the machine, at most 256MB, and 256MB when neither is known. The two add up for an upload over WebSocket to S3, which is why neither defaults to the full 256MB in a small container. A part waits for room in `appendChunk`, which is what slows the sender down. Only parts on their way count, never the start of a part still filling up: counting those could leave every upload waiting for room that only more data would free. Those count against `FillMemory` instead, half of `S3_MEMORY_LIMIT`, which never waits: a session that finds no room moves the part it is filling into a file under `DATA_DIR/tmp/s3-parts/` (emptied on start) and fills it there. Uncounted, many slow uploads that each stopped short of a part filled the server's memory past every limit. Do not move every part to disk: the copies through the file cost 15 to 35 percent of the speed to a fast bucket, and with parallel uploads on a box with half a core, 512 MiB and an SD card class disk 62 percent (2026-10-16). `appendChunk` reads two parts ahead and cuts them after, like before the limit, since sending each part between two reads of the same stream cost the chunked transport a fifth more CPU. `save()` goes through `createEmpty`, `appendChunk` and `finalizeChunkedUpload` too, so a single-request upload is bounded the same way. Do not bring `@aws-sdk/lib-storage` back, its `Upload` buffers parts outside the limit.
- S3 downloads prefer a presigned URL, which means the browser talks to the bucket directly. The bucket's CORS policy has to allow the instance origin, and `bucketConnectSources()` in `lib/bucket-csp.ts` widens the CSP `connect-src` accordingly. Without `S3_FORCE_PATH_STYLE` the AWS SDK puts the bucket into the host (`<bucket>.<account>.r2.cloudflarestorage.com`), which the CSP has to allow, the Service Worker included since `download-sw.js` carries the same CSP. Releases up to 3.0.1 allowed only the endpoint, which blocked every download from R2 and Hetzner set up as the docs show. The end-to-end tests run SeaweedFS with path style, so only `tests/bucket-csp.test.ts` covers the other form, against URLs the SDK really builds. For AWS without an endpoint it allows the regional host and the host of the own bucket, never `*.s3.<region>.amazonaws.com`, which would let a script that got into the page send data to any bucket of the region.
- A new backend implements the full interface. Returning `false` from `supportsPresignedUrls()` is a valid answer, silently no-op'ing a method is not.

## Uploads

Three transports, one validation path. All of them parse through `uploadHeadersSchema` and `validateUploadHeaders` in `src/lib/upload-validation.ts` - keep it that way, a check added to only one transport is a hole.

**Chunked HTTP** (`src/routes/upload.ts` on top of `src/lib/chunked-upload.ts`, which uploads into a file request share): `POST /init` opens an in-memory session, chunks arrive at `POST /:id/chunk?index=N` possibly out of order, each body is streamed into a file in `DATA_DIR/tmp/chunks/` (emptied on start), and the files are appended in index order through a promise chain so `appendChunk` is never concurrent. Chunk data never stays in memory. The limits are checked per read: 16 MiB per chunk, all chunks of a session within the declared size, `FILE_UPLOAD_CONCURRENT_CHUNKS` requests in flight per session, each index once, no empty chunk, at most 64 chunks waiting for an earlier one. Never go back to reading a whole body into memory before checking it (GHSA-9rmm-v3p2-c26g). `POST /:id/finalize` commits the row. Sessions expire after one hour and are swept every ten minutes.

**Single-request HTTP** (`POST /api/upload`): streams one body straight to storage. Legacy, still kept as a simple fallback.

**WebSocket** (`src/routes/upload-ws.ts` on top of `src/lib/ws-upload.ts`, which uploads into a file request share): the primary path when `FILE_UPLOAD_WS=true`. Registered only when the flag and the `file` service are both on, and it validates the `Origin` header itself as defence in depth. The request route registers its own handler at `/api/request/:id/upload/ws` when the flag and the `request` service are on. A target adds only its init check, its commit and what to give back when a session ends without a commit, so the framing, buffering, backpressure and keepalive stay one piece of code. A buffer below the 4 MB flush threshold is written out a second after its first frame, and a session that receives less than 1 MiB, or the rest of its upload, in 10 minutes is ended, so a trickling client holds neither memory nor a claim. An empty origin is allowed on purpose so the CLI and curl still work - the comment at that check explains it.

Chunk requests are intentionally exempt from the global rate limiter - the reasoning is written out at the exemption in `src/index.ts`. Read it before changing that condition. `skipsRateLimit()` in `middleware/rate-limit.ts` lets only chunks through: every request that opens a session counts, the WebSocket upgrades of both routes included, since an upgrade opens a session like an init (GHSA-rmc2-p8pp-4vmh). Never exempt them again. The limits in `src/routes/upload.ts` are what bound chunk traffic. The quota does not, it reserves the declared size of an upload at its start.

**WebSocket** (`src/routes/upload-ws.ts`): `ws` buffers a whole message before `onMessage` runs, outside `WsBufferMemory`, so `src/index.ts` lowers `maxPayload` to `WS_MAX_PAYLOAD` (320 KiB) and a session that has sent no complete message for `FRAME_STALL_MS` (150 s) is ended, unless the server holds it back. Together they bound what a connection that stops in the middle of a message can hold. The clients send 256 KiB frames, and 150 s is how long a frame takes at the slowest rate the progress rule allows, so an honest slow sender never hits it. All WebSocket sessions of both routes share one `WsBufferMemory` (`FILE_UPLOAD_WS_MEMORY_LIMIT`), created once in `src/index.ts` and passed to both, since a budget per route would let them fill twice the limit. A session that receives while the budget is full pauses its socket, and a write that frees room resumes the waiting ones. Nothing is refused, so many users behind one address are not turned away, which a cap per IP would do. A session the server holds back is not ended by the progress timeout, and a connection that sends no init within 30 s is closed. Every byte a session takes from the budget goes back when it is written or when the session closes, `flushChunks` and `close()` are the two places.

## Rate limiting, quota, and lockout

- **Rate limiter** (`middleware/rate-limit.ts`): in-memory sliding window keyed by client IP, `RATE_LIMIT_WINDOW` / `RATE_LIMIT_MAX`, emits `X-RateLimit-*` headers. Also applied to `/auth/*`. `getClientIp` honours `TRUST_PROXY` - only trust forwarded headers when the operator opted in. It returns the address in the form every limit counts by (`toLimitKey`): IPv6 as its /64 network, IPv4-mapped IPv6 as IPv4, so a client cannot reset a limit with a new address from its own /64.
- **Quota** (`middleware/quota.ts`): per-IP byte budget over `FILE_UPLOAD_QUOTA_WINDOW`, disabled when `FILE_UPLOAD_QUOTA_BYTES=0`. IPs are HMAC-hashed with a key that rotates every 24 hours, and state is persisted in `quota_state` so restarts do not reset budgets. Never store or log a raw IP here.
  An upload reserves its declared size when it starts (`reserve()`, or the middleware on the chunked init and the single-request upload, never on chunk or finalize requests). Every transport ends the reservation exactly one way: `commit()` once the upload is stored, `release()` when it ends without being stored. A reservation also lapses with its quota window, so a missed release cannot block a sender for good. Parallel uploads used to pass the check against the same used bytes, so never go back to counting only finished uploads.
- **Password lockout** (`lib/password-lockout.ts`): one shared instance for the password, download, note and inbox routes, `PASSWORD_MAX_ATTEMPTS` failures lock a resource for `PASSWORD_LOCKOUT_MS`. Failures that led to no lock are forgotten after `PASSWORD_LOCKOUT_MS`. The inbox counts a wrong token only for a request that exists and has a password, and a missing or malformed token never: an inbox without a password has a 256-bit key nobody guesses, and counting more would let anyone lock a requester out. Whoever holds the request ID can therefore tell whether its inbox has a password, which is accepted. The password check and the download share the key `file:<id>`, so a guesser cannot switch between them. Every route checks the lock again after its last `await` and records the result before the next one (`lockedResponse`, `guessLimitedAuth` in the download route): checked only at the start, a burst of parallel guesses all passed the check before the first failure was recorded, and got far more than `PASSWORD_MAX_ATTEMPTS`. The metadata of a password-protected upload never goes out before a correct password, or anyone with the link could test guesses offline against its GCM tag (GHSA-rxxj-c5wr-phqp).
- **Daily request limit** (`lib/request-limit.ts`): `FILE_REQUEST_DAILY_LIMIT` new requests per OIDC user or IP, HMAC-hashed, in memory only. A restart resets it.

## Security headers and middleware order

`src/index.ts` sets a strict CSP through `secureHeaders`. Several directives carry a comment explaining exactly why they are as loose as they are (`wasm-unsafe-eval` for hash-wasm, `unsafe-inline` styles for two computed style props, `connect-src` for S3, `form-action` for the OIDC issuer, `img-src` for an external `CUSTOM_LOGO`). Widening any of them means updating that comment with the new reason, or better, removing the need.

Order matters and is easy to break:

1. `logger`, `secureHeaders`, CORS (health first with `*`, then the allowlist from `BASE_URL` + `CORS_ORIGINS`)
2. `app.onError` - returns a generic message with `Cache-Control: no-store`
3. `/api` group: `no-store` on every response, then the rate limiter with its chunk and WS exemptions
4. Service guards, then the routes, and last of the `/api` group the JSON 404 for an unknown path, which otherwise fell into the SPA fallback with 200. A route added after it is never reached
5. `/branding/*`, `/assets/*` (immutable caching, served from memory by `createAssetHandler`), the SPA fallback, then the catch-all static handler

The SPA fallback must stay ahead of the catch-all `serveStatic`, otherwise `GET /` bypasses the `__CUSTOM_TITLE__` injection. `/assets/*` goes out as one buffer per response on purpose: streamed, the headers left on their own and TCP held the body back about 200 ms per file on a fresh loopback connection, which is how a reverse proxy on the same host connects. Do not put it back on `serveStatic`. Error responses and `index.html` are `no-store` on purpose - the comments explain the caching-proxy failure they prevent.

Node timeouts at the bottom of the file (`headersTimeout` 60 s, `requestTimeout` 0, `keepAliveTimeout` 120 s) are tuned for slow multi-hour uploads behind a proxy. Each one has a comment. Do not "clean them up".

## Logging

`console.log` / `warn` / `error` with a bracketed prefix (`[storage]`, `[quota]`, `[oidc]`, `[skysend]`) is the house style here - there is no logger abstraction, and adding one is not on the roadmap.

What must never be logged: secrets, derived keys, auth or owner tokens, request bodies, filenames, note content, raw IP addresses. Log an error through `describeError()` from `lib/log-error.ts`, never the error object itself: openid-client keeps the claims of an ID token in `cause`, and Drizzle's async drivers write the query parameters, tokens among them, into the message. The Hono request logger records method, path, status, and duration only, and that comment in `src/index.ts` is a deliberate audit note.

Errors returned to the client stay generic. Details go to the log, not the response.

## Tests

Vitest, files in `apps/server/tests/`, run with `pnpm --filter @skysend/server test`. Coverage config in `vitest.config.ts` excludes `src/index.ts`, the type-only files, and the S3 backend.

- Tests run against a real temporary SQLite database, not a mock.
- New route: cover the happy path, a rejected invalid token, and the boundary that the Zod schema enforces.
- Security-relevant behavior gets a test that fails against the old code - constant-time comparison, lockout counting, quota accounting, origin checks.
- Never assert on log output. Assert on status codes, response bodies, and persisted rows.
