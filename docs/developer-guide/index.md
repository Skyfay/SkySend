# Developer Guide

Welcome to the SkySend developer documentation. This guide covers the codebase architecture, development setup, and technical details for contributors.

## Project Overview

SkySend is a monorepo managed with pnpm Workspaces, consisting of:

| Package | Path | Description |
| --- | --- | --- |
| `@skysend/server` | `apps/server` | Hono-based REST API |
| `@skysend/web` | `apps/web` | React SPA (Vite + Shadcn UI) |
| `@skysend/client` | `apps/client` | CLI client binary (Bun compile) |
| `@skysend/cli` | `apps/cli` | Admin CLI tool |
| `@skysend/crypto` | `packages/crypto` | Shared encryption library |
| `@skysend/docs` | `docs` | VitePress documentation |

## Tech Stack

| Area | Technology |
| --- | --- |
| Runtime | Node.js 24 LTS |
| Backend | Hono |
| Frontend | Vite + React 19 + Shadcn UI |
| CLI Client | Commander.js + Bun compile |
| ORM | Drizzle ORM |
| Database | SQLite (via better-sqlite3) |
| Crypto | Web Crypto API (native) |
| Validation | Zod |
| i18n | react-i18next |
| Password KDF | Argon2id (WASM) |
| Zip | fflate |
| Monorepo | pnpm Workspaces |
| Tests | Vitest |

## Quick Links

- [Architecture](/developer-guide/architecture) - System architecture and data flow
- [Download Modes](/developer-guide/download-modes) - Browser-specific download strategies
- [Toast System](/developer-guide/toast-system) - In-app toast notifications, `showToast()`, and known-error enrichment
- [Project Setup](/developer-guide/setup) - Set up a local development environment
- [API Reference](/developer-guide/api/) - REST API documentation
- [Cryptography](/developer-guide/crypto/) - Encryption library details
- [Database Schema](/developer-guide/reference/schema) - SQLite schema reference

## Contributing

### Branches and Pull Requests

| Branch | What it holds |
| :--- | :--- |
| `main` | The released code. Each release merges `dev` into `main` and is tagged `vX.Y.Z` |
| `dev` | Everything that is finished, waiting for the next release |
| Feature branches | One feature or fix each, branched off `dev` |

Pull requests go into `dev`, never into `main`. Only the maintainer merges `dev` into `main` for a release.

```bash
git checkout dev
git pull
git checkout -b feat/short-description
# ... commit your work
git push -u origin feat/short-description
# then open the pull request with dev as its base
```

Every pull request into `dev` or `main` runs lint, type check, unit tests and the builds of the docs and the website.

### Releasing

Only the maintainer releases, from an up to date `dev`. `pnpm toolbox` lists every command used here in one menu, each also runs on its own:

1. `pnpm version:bump` checks the changelog fragments and asks GitHub for the CodeQL alerts open on `dev` that `main` does not have. While one is open, it asks whether to go on. Then it picks the next version, writes its block into `docs/changelog.md` and sets the version in every package. `pnpm codeql:check` runs the CodeQL part on its own.
2. Replace `*Release: In Progress*` with `*Released: <date>*`, commit, push `dev` and open the pull request from `dev` into `main`. Merge it with a merge commit, not a squash, so both branches keep their history. A change that still belongs to the release after the bump gets its fragment as usual, and `pnpm changelog:amend` adds it to the block.
3. `pnpm release:tag` proposes the tag of the version on `main`, with the title from the changelog as its message, and pushes it once you confirm. The tag starts the release workflow. `pnpm release:untag` deletes a tag here and on GitHub, so a release that failed can be tagged again.

### PR Guidelines

1. Create a feature branch off `dev`
2. Write tests for new features
3. Update documentation
4. Write the changelog entry into a fragment under `changelog/unreleased/`, named after your branch
5. Run `pnpm validate` before submitting
6. Open the pull request against `dev`

Security vulnerabilities are never reported in a pull request or an issue. See [SECURITY.md](https://github.com/Skyfay/SkySend/blob/main/SECURITY.md).

