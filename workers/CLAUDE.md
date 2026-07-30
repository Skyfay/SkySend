# Cloudflare Workers

Two small Workers that serve the public project infrastructure. They are **not** part of a SkySend instance - a self-hoster never runs them, and nothing in `apps/` may depend on them.

Each is a single `src/index.ts` with no runtime dependencies, TypeScript against `@cloudflare/workers-types`, configured by `wrangler.jsonc`.

| Worker | Package | Domain | Purpose |
| :--- | :--- | :--- | :--- |
| `instances` | `@skysend/instances-worker` | `instances.skysend.app` | Polls registered public instances on a cron, caches the result in KV |
| `report` | `@skysend/report-worker` | `report.skysend.app` | Accepts abuse reports from the website, forwards them by email |

## Shared rules

- **No dependencies.** These run on the Workers runtime - `fetch`, `Request`, `Response`, `URL`, and the bindings are the whole toolbox. No Node APIs, no `zod`, no imports from other workspace packages. That is deliberate, not an oversight.
- **Deploys are automatic.** Pushing to `main` with changes under `workers/<name>/**` triggers the matching workflow in `.github/workflows/`. Do not run `wrangler deploy` by hand for a normal change.
- **Secrets live in Cloudflare**, set with `wrangler secret put`. Never in `wrangler.jsonc`, never in the repo. `TURNSTILE_SECRET` is the one that exists today.
- **Bindings are declared in `wrangler.jsonc`** and typed in the `Env` interface at the top of `src/index.ts`. Both have to change together.
- `pnpm dev` at the root deliberately skips both Workers. Use `pnpm --filter @skysend/<name>-worker dev` (wrangler dev), `... tail` for live logs, and `... typecheck` before pushing.
- Changelog scope for anything here is `**infra**`.

## instances

Fetches `/api/health` and `/api/config` from every instance in `https://docs.skysend.app/instances.json`, with an 8-second timeout each, and writes the merged result to the `SKYSEND_INSTANCES` KV namespace under the key `instances`. A cron trigger runs every 30 minutes, and the `GET` handler serves the cached value so the docs site makes exactly one request.

The registry file lives in `docs/public/instances.json`. Its shape is duplicated in this Worker's local interfaces, so a field added there must be added here too.

An instance that is unreachable must degrade to a marked-offline entry, never take the whole response down.

## report

Handles the abuse report form on skysend.app.

- `GET /instances` proxies the registry with CORS headers and a 300-second edge cache, which is where the website gets its instance list.
- `POST /` validates the body, verifies the Cloudflare Turnstile token against `TURNSTILE_SECRET`, looks up the reported instance's abuse contact in the registry, and sends the report through Cloudflare Email Routing using the `REPORT_EMAIL` binding.

Rules specific to this Worker:

- `ALLOWED_ORIGINS` is an explicit allowlist plus localhost for development. Keep it narrow.
- Turnstile is verified **before** any other work. That check is the only thing between this endpoint and a spam relay.
- The recipient always comes from the registry lookup by hostname, never from the request body. A user-supplied destination address would turn this into an open relay, and the lookup doubles as the check that the reported instance is a known one.
- Every user-supplied value that reaches the email body goes through `escapeHtml()`. Adding a field to `buildHtmlEmail` without it is an HTML injection into someone's inbox.
- Field and reason changes have to stay in sync with `website/src/lib/report.ts`.
