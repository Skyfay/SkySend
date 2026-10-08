# SkySend

Minimalist, self-hostable, end-to-end encrypted file and note sharing. Zero knowledge: the server stores ciphertext and never receives the key.

A pnpm monorepo built on **Hono** (backend), **React 19 + Vite + Shadcn UI** (SPA), **Drizzle + better-sqlite3** (storage), and a shared **Web Crypto** library. Two CLIs, a VitePress docs site, a Next.js marketing site, and two Cloudflare Workers live in the same tree.

Read [PHILOSOPHY.md](PHILOSOPHY.md) before proposing a feature. No accounts, no analytics, no persistent storage - features that add those are declined by design.

## The rule everything else serves

**The secret never reaches the server.** A 32-byte secret is generated in the client, all keys are derived from it via HKDF, and it is placed in the URL fragment (`/file/<id>#<secret>`) which browsers never transmit. The server sees an opaque ID, an encrypted blob, encrypted metadata, and two derived tokens.

Anything that would send the secret, a derived key, a plaintext filename, or note content to the server breaks the product's only promise. Treat such a change as a bug, not a trade-off, no matter how convenient it looks.

## Guide map

Claude Code loads the nearest `CLAUDE.md` when you touch files in a directory. Read the matching guide before working in that area:

| Working on | Guide |
| :--- | :--- |
| API routes, middleware, storage, database, OIDC | [apps/server/CLAUDE.md](apps/server/CLAUDE.md) |
| React SPA, UI components, hooks, i18n, toasts | [apps/web/CLAUDE.md](apps/web/CLAUDE.md) |
| Encryption, key derivation, ECE streams | [packages/crypto/CLAUDE.md](packages/crypto/CLAUDE.md) |
| Note content format, legacy notes | [packages/note-format/CLAUDE.md](packages/note-format/CLAUDE.md) |
| End-user CLI and the Ink TUI | [apps/client/CLAUDE.md](apps/client/CLAUDE.md) |
| Admin CLI (runs on the server, direct DB access) | [apps/cli/CLAUDE.md](apps/cli/CLAUDE.md) |
| Docs site and the changelog | [docs/CLAUDE.md](docs/CLAUDE.md) |
| Marketing website (skysend.app) | [website/CLAUDE.md](website/CLAUDE.md) |
| Cloudflare Workers | [workers/CLAUDE.md](workers/CLAUDE.md) |

## Non-negotiable rules

1. **Package manager is `pnpm`.** Never `npm install` or `yarn`. Workspace-scoped commands use `pnpm --filter @skysend/<pkg> <script>`.
2. **Never weaken the zero-knowledge boundary.** See the rule above and [packages/crypto/CLAUDE.md](packages/crypto/CLAUDE.md).
3. **Validate every external input with Zod** - request headers, request bodies, environment variables, API responses in the frontend. No hand-rolled parsing at a trust boundary.
4. **Write TypeScript, avoid `any`.** `@typescript-eslint/no-unused-vars` is an error, a leading `_` is the escape hatch.
5. **Every change gets a changelog entry** in the same response, written into the fragment of its branch under `changelog/unreleased/`, never into `docs/changelog.md`. AI tooling changes get none. See [Changelog workflow](#changelog-workflow).
6. **Typography**: no em dashes, no semicolons joining clauses. Use a hyphen where a dash is needed, and end sentences with a period. Applies to code comments, docs, changelog entries, and commit messages.
7. **Language**: all code, comments, and documentation in English. User-facing strings go through i18n, never inline.
8. **Never log secrets, keys, tokens, plaintext, or IP addresses.** The request logger records method, path, status, and duration only. Quota tracking uses HMAC-hashed IPs with a daily rotating key.
9. **Branches: feature branch, then `dev`, then `main`.** Work happens on a feature branch off `dev`, its pull request goes into `dev`, and a release merges `dev` into `main`. A pull request or a base branch suggested to anyone points at `dev`, never at `main`.

## Architecture

```
apps/server/     Hono API + static SPA serving + SQLite. The only long-running process.
apps/web/        React 19 SPA. Owns all encryption and decryption in the browser.
apps/client/     End-user CLI + Ink TUI. Talks to the API the same way a browser does.
apps/cli/        Admin CLI. Runs beside the server, reads the DB directly.
packages/crypto/ Shared Web Crypto library. Imported by web, client, and server.
packages/note-format/ What a note holds before encryption. Imported by web and client.
docs/            VitePress docs site (docs.skysend.app).
website/         Next.js marketing site (skysend.app).
workers/         Cloudflare Workers: instance registry and abuse reports.
```

Data flow for an upload:

```
Browser: generateSecret -> deriveKeys (HKDF) -> encrypt file (ECE) + metadata (AES-GCM)
              |                                          |
              |                            authToken, ownerToken (derived)
              v                                          v
Server:  ciphertext blob (filesystem or S3) + a row in SQLite
              |
Link:    https://host/file/<id>#<secret>     <- fragment, never sent to the server
```

Notes follow the same shape with a single AES-GCM payload instead of a stream. Both services are gated by `ENABLED_SERVICES`, so no route may assume its service is enabled.

The server is single-instance by design. Rate limiting, upload sessions, and password lockout live in memory - reach for the reverse proxy before reaching for Redis.

## Commands

```bash
bash scripts/setup-dev-macos.sh  # First setup on a Mac: fnm, Node from .node-version, pnpm, dependencies
pnpm dev                  # All workspaces in parallel, except the two Cloudflare Workers
pnpm build                # Recursive build
pnpm validate             # Lint + typecheck + tests, same as CI (scripts/validate.sh)
pnpm lint                 # eslint . (lint:fix to autofix)
pnpm typecheck            # Builds crypto + server first, then tsc across the tree
pnpm test                 # Recursive vitest run
pnpm test:coverage        # Coverage for server, web, crypto, client
pnpm format               # prettier --write .
pnpm update:check         # Outdated dependencies per workspace (scripts/check-updates.sh)
```

Version and release helpers:

```bash
pnpm version:bump         # Interactive version picker, syncs every package.json + changelog
pnpm version:sync         # Propagate the root version without bumping
pnpm changelog:preview    # Show the changelog block the next release writes from the fragments
pnpm changelog:check      # Check every fragment under changelog/unreleased/
```

Single workspace: `pnpm --filter @skysend/web build`, `pnpm --filter @skysend/docs dev`, and so on. Package names are `@skysend/server`, `-web`, `-client`, `-cli`, `-crypto`, `-docs`, `@skysend/website`, `@skysend/instances-worker`, `@skysend/report-worker`.

`pnpm dev` runs the server against `.env.dev` at the repo root. Vite serves the SPA on `:5173` and proxies `/api`, `/auth`, and `/branding` to the server on `:3000`. `BASE_URL` and `CORS_ORIGINS` in `.env.dev` therefore point at the Vite origin, not the server one.

## Changelog workflow

Every change - feature, bug fix, security fix, refactor with user-visible impact, docs, CI, Docker - gets an entry in the same response. Do not defer it.

**Exception: AI tooling changes never get a changelog entry.** The changelog is published on the docs site for people who run SkySend. Anything that only configures the assistant is invisible to them:

- `CLAUDE.md` files anywhere in the tree
- `.claude/` in full - agents, skills, commands, settings
- `.gitignore` rules that only exist to track those files

The test is who the line is for. A reader upgrading their instance never needs to know a prompt file changed. Code that ships in the repository still counts, even when it exists to keep the assistant honest.

**Inside an entry there is no `;` and no hyphen used as a dash**, which means no hyphen followed by a space. Stricter than the typography rule above, which allows one. A sentence reaching for either is doing too much work, so split it or cut it. Hyphenated words stay, and so does the hyphen that opens the line as the list marker.

**Where the entry goes**: into `changelog/unreleased/<branch>.md`, named after the branch with `/` replaced by `-`, never into `docs/changelog.md`. One file per branch, in the Markdown of a version block without the version header and the Docker section, so pull requests that run side by side never touch the same file. A branch that changes its mind edits its own file. `pnpm version:bump` collects the fragments into `docs/changelog.md` at the release and deletes them, a test checks every fragment, and `pnpm changelog:preview` shows the block the next release writes. Format and example: [changelog/unreleased/README.md](changelog/unreleased/README.md).

**Section order** (skip sections with no entries, never reorder):

| # | Change type | Section |
| :--- | :--- | :--- |
| 1 | New feature or capability | `### ✨ Features` |
| 2 | Bug fix in an already released version | `### 🐛 Bug Fixes` |
| 3 | Security fix | `### 🔒 Security` |
| 4 | Performance, UX, quality | `### 🎨 Improvements` |
| 5 | Behavior change (non-breaking) | `### 🔄 Changed` |
| 6 | Removed feature or code | `### 🗑️ Removed` |
| 7 | Documentation | `### 📝 Documentation` |
| 8 | Tests added or changed | `### 🧪 Tests` |
| 9 | GitHub Actions, Dockerfile, scripts | `### 🔧 CI/CD` |
| 10 | Docker image info (always last, written by the release) | `### 🐳 Docker` |

**Bug fix policy**: only log fixes for problems in released versions. A bug found and fixed while building an unreleased feature is part of that feature, not a separate entry.

Entry format, scopes, and the remaining rules live in [docs/CLAUDE.md](docs/CLAUDE.md).

## File conventions

- **Naming**: `kebab-case` for server, CLI, crypto, and website files (`upload-validation.ts`, `report-form.tsx`). `PascalCase` for React components in `apps/web/src/components/` and `apps/client/src/tui/`, `camelCase` for web hooks (`useDownload.ts`).
- **Imports**: server, client, cli, and crypto are ESM and need the `.js` extension on relative imports (`./lib/config.js`). The web app and website use the `@/` alias with no extension.
- **Exports**: named exports. No barrel files except `packages/crypto/src/index.ts` and `packages/note-format/src/index.ts`, the public APIs of those packages.
- **Prettier**: double quotes, semicolons, 2-space indent, trailing commas, 100 columns. Run `pnpm format` instead of hand-aligning.
- **Keep functions short.** If something is used once, inline it - no abstractions for their own sake.

## Quick reference

| Concern | Location |
| :--- | :--- |
| Server config schema (all env vars) | [apps/server/src/lib/config.ts](apps/server/src/lib/config.ts) |
| Database schema | [apps/server/src/db/schema.ts](apps/server/src/db/schema.ts) |
| API routes | [apps/server/src/routes/](apps/server/src/routes/) |
| Storage backends | [apps/server/src/storage/](apps/server/src/storage/) |
| Crypto public API | [packages/crypto/src/index.ts](packages/crypto/src/index.ts) |
| Frontend API client | [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts) |
| Toast helpers | [apps/web/src/lib/toast.tsx](apps/web/src/lib/toast.tsx) |
| Translations | [apps/web/src/i18n/](apps/web/src/i18n/) |
| Changelog fragments (unreleased) | [changelog/unreleased/](changelog/unreleased/README.md) |
| Changelog (released) | [docs/changelog.md](docs/changelog.md) |
| Published env var reference | [docs/user-guide/configuration/environment-variables.md](docs/user-guide/configuration/environment-variables.md) |
| Dev environment | [.env.dev](.env.dev), [.env.example](.env.example) |
| CI | [.github/workflows/validate.yml](.github/workflows/validate.yml), [pr-build.yml](.github/workflows/pr-build.yml) |

## Before finishing a change

1. `pnpm validate` passes (lint, typecheck, tests).
2. The fragment of the branch under `changelog/unreleased/` has an entry, unless the change is AI tooling only.
3. A new or changed env var exists in `apps/server/src/lib/config.ts`, `.env.example`, and the published env var reference.
4. New user-facing strings exist in `en.json` and `de.json`, plus the 11 AI-translated locales.
5. Nothing new is logged that identifies a user or reveals plaintext.
