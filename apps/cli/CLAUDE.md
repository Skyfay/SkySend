# Admin CLI

`@skysend/cli` - the operator tool, installed in the Docker image as `skysend-cli`. Commander plus Drizzle, no HTTP client. It runs **beside** the server and reads the same SQLite file and uploads directory directly.

Do not confuse it with `apps/client`, which is the end-user CLI that talks to the API over the network. Different audience, different trust model, different binary name.

## What it can and cannot do

It sees database rows and blob sizes. It cannot decrypt anything - the secrets only exist in share links, which never reach the server. `list --json` deliberately strips `salt`, `encryptedMeta`, `nonce`, and `passwordSalt` from its output. Keep that filter when adding a column, and never widen it to include `ownerToken` or `authToken`.

## Layout

```
src/index.ts        Commander wiring, withContext() lifecycle, top-level error handler
src/lib/context.ts  Opens config, DB, and storage. destroyContext() closes the DB.
src/lib/format.ts   formatBytes, formatDate, formatDuration, formatExpiry, table
src/commands/       list, delete, stats, cleanup, config
```

Commands: `list [-a] [--json]`, `delete <id>`, `stats [--json]`, `cleanup [-n]`, `config [--json]`.

## The server dependency

Everything shared comes through `@skysend/server`'s package exports, never a deep relative path:

```ts
import { initDatabase, closeDatabase, getDb } from "@skysend/server/db";
import { uploads, notes } from "@skysend/server/db/schema";
import { loadConfig } from "@skysend/server/lib/config";
import { FileStorage } from "@skysend/server/storage/filesystem";
```

Those five subpath exports (`./db`, `./db/schema`, `./lib/config`, `./lib/cleanup`, `./storage/filesystem`) are the entire contract. Needing a sixth means adding it to `apps/server/package.json` `exports` first, which is a deliberate decision, not a shortcut.

The server must be built before the CLI - `tsconfig.json` has a project reference to it, and the exports point at `dist/`.

Because `loadConfig()` reads the same environment variables as the server, the CLI must run with the same env. Inside the container that is automatic. Outside, `DATA_DIR`, `UPLOADS_DIR`, and `BASE_URL` have to be set.

The CLI only ever constructs `FileStorage`. On an S3 instance, blob-level commands operate on the local uploads directory, not the bucket - do not silently pretend otherwise in output or docs.

## Conventions

- Every command runs inside `withContext()` so the SQLite handle is always closed, including on failure.
- Both `list` and `stats` support `--json`. New commands that produce data should too. `--json` prints one JSON object and nothing else.
- Human output goes through `lib/format.ts`. Dates are ISO-ish UTC (`formatDate`), sizes go through `formatBytes`, tables through `table()`. No ad-hoc padding.
- `console.log` for output, `console.error` for failures, exit 1 on error. That is the whole logging story.
- Expiry filtering is duplicated between `list` and `cleanup` by intent: the sweep in `@skysend/server/lib/cleanup` owns deletion, `list` only reads. Note the asymmetry - a note with `maxViews = 0` is unlimited, an upload always has a positive `maxDownloads`.
- A destructive command states what it will remove before doing it. `cleanup` has `-n` / `--dry-run` for exactly that, so any new destructive command gets the same flag.

## Docs and tests

Every command change updates `docs/user-guide/admin-cli/commands.md`.

There are no tests in this package (`test` is `vitest run --passWithNoTests`). Logic worth testing belongs in `@skysend/server`, where the test suite already exists, and the CLI just calls it.
