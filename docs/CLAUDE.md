# Documentation and Changelog

VitePress site published at docs.skysend.app, deployed to Cloudflare from `.vitepress/dist`. Content language is English. Tone is clear, concise, and practical - written for self-hosters and sysadmins. No marketing fluff, no restating the obvious.

```bash
pnpm --filter @skysend/docs dev     # local preview
pnpm --filter @skysend/docs build   # build:local skips the git fetch used for lastUpdated
```

---

# Part 1 - Wiki pages

## Structure

Two sidebars, defined in `.vitepress/config.mts`. A new page must be added there or it is unreachable.

```
/user-guide/       Getting Started, Self-Hosting, Configuration, Admin CLI, CLI Client, Security, Help
/developer-guide/  Introduction, API Reference, Cryptography, Reference
/                  index, instances, roadmap, screenshots, benchmarks, changelog
```

`instances.md` documents the public instance list and `public/instances.json` is the machine-readable registry behind it, served at `docs.skysend.app/instances.json`. Both Cloudflare Workers and the marketing site read that file, so changing its shape breaks all three. Adding an instance means editing the JSON and the page together.

## Content principles

- **Verify every claim against the code.** Config fields, defaults, headers, and status codes must match `apps/server/src/lib/config.ts` and the route that implements them. Do not document a field that does not exist, and do not leave one documented after it is removed.
- **One source of truth.** Link instead of repeating. The environment variable reference is the canonical list, other pages link into its anchors.
- **Do not document external products.** Link to the official docs for AWS IAM, Cloudflare R2, Keycloak, or Nginx rather than explaining them.
- **Anchors are contracts.** `apps/web/src/lib/toast.tsx` links directly at troubleshooting anchors. Renaming such a heading breaks a link that ships inside the app, so update both together.
- **Screenshots are optional.** Only when a UI flow is genuinely confusing.

## Page conventions

- One `#` H1 per page, matching the sidebar label closely enough to be recognisable.
- Config tables carry a Required column and the real default, and field names match what the operator actually types.
- YAML examples use the `docker compose` `environment:` shape, since that is how nearly everyone runs this.
- Callouts: `::: tip`, `::: warning`, `::: danger`, `::: info`. `::: code-group` for multi-variant blocks, `<details>` for optional provider-specific setup.
- Troubleshooting entries cover errors users actually hit. Each one states the symptom, the cause, and the fix, in that order.

---

# Part 2 - Changelog format (`docs/changelog.md`)

## What never gets an entry

This file is published for people who run SkySend. AI tooling is invisible to them and stays out:

- `CLAUDE.md` files anywhere in the tree
- `.claude/` in full - agents, skills, commands, settings
- `.gitignore` rules that only exist to track those files

Code that ships in the repository still counts, even when its purpose is to keep the assistant honest.

## Active version

The topmost `## vNEXT` block, or the topmost `## vX.Y.Z` block marked `*Release: In Progress*`. If neither exists, run `pnpm changelog:next` - it inserts a `vNEXT` placeholder with the Docker section already filled in. `pnpm version:bump` later rewrites `vNEXT` into the real version and fixes the image tags.

## Entry format

```
- **scope**: Description of the change ([#N](url))
```

**Scope** identifies the affected part of the monorepo. Always exactly one, never two joined:

| Scope | Covers |
| :--- | :--- |
| `server` | Backend API, database, storage, middleware (`apps/server`) |
| `web` | Frontend UI, components, hooks, pages (`apps/web`) |
| `client` | End-user CLI and TUI (`apps/client`) |
| `cli` | Admin CLI (`apps/cli`) |
| `crypto` | Encryption library (`packages/crypto`) |
| `docs` | Documentation site (`docs/`) |
| `website` | Marketing site (`website/`) |
| `docker` | Dockerfile, docker-compose, entrypoint |
| `infra` | CI/CD, monorepo config, ESLint, TypeScript, build tooling, Workers |

A change spanning several scopes becomes several entries, one per scope. Never `**web, server**:`.

**Description** - one sentence, as short as it can be while still making sense. Two only if unavoidable. Write **what** changed, not why or how. No file paths, function names, root causes, or internals - those belong in the commit message.

**Issue links** go at the end as `([#N](https://github.com/Skyfay/SkySend/issues/N))`, never inside the scope.

**One entry per user-visible change.** A pull request touching 20 files to deliver one behavior change is one line. Two unrelated changes in one pull request are two lines.

Security entries name the advisory: `Updated hono to 4.12.32 to patch ... (GHSA-hvrm-45r6-mjfj)`.

## Section order

Never rearrange. Omit sections with no entries. Do not invent new ones.

| # | Section | Use for |
| :--- | :--- | :--- |
| 1 | `### ✨ Features` | New features and capabilities |
| 2 | `### 🐛 Bug Fixes` | Bug fixes |
| 3 | `### 🔒 Security` | Security-related changes |
| 4 | `### 🎨 Improvements` | Performance, UX, quality |
| 5 | `### 🔄 Changed` | Changed behavior (non-breaking) |
| 6 | `### 🗑️ Removed` | Removed features, deprecated code |
| 7 | `### 📝 Documentation` | Documentation changes |
| 8 | `### 🧪 Tests` | Tests added or changed |
| 9 | `### 🔧 CI/CD` | Pipeline, Dockerfile, script changes |
| 10 | `### 🐳 Docker` | Docker image info (always last) |

## Bug fix policy

Only log fixes for problems in **already released** versions. A problem found and fixed while building an unreleased feature is part of that feature, not a separate bug fix.

- A footer link feature breaks on a bad import, fixed in the same session -> not a bug fix
- Downloads fail on Safari after v1.0.0 shipped -> bug fix
- A test fails during development of a new upload flow -> not a bug fix
- Rate limiting stops working in production after a dependency update -> bug fix

## Version header

```markdown
## vX.Y.Z - Short Title
*Released: Month Day, Year*
```

Unreleased versions use `*Release: In Progress*`.

## Breaking changes

A blockquote directly below the release date, before any section:

```markdown
> ⚠️ **Breaking:** What breaks and how to migrate.
```

## Docker section

Last section of every version with a published image:

```markdown
### 🐳 Docker

- **Image**: `skyfay/skysend:vX.Y.Z`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64
```

Tag rules: stable releases get `latest` plus the major tag (`v2`), `-beta` releases get `beta`, `-dev` releases get `dev`. `pnpm version:bump` fills these in.

## Additional rules

- Newest version at the top.
- No `---` separators between versions. VitePress renders them.
- Entries are grouped under `###` headings, never a flat list.
- No em dashes, no semicolons joining clauses.

## Example

```markdown
## v2.12.0 - Branding and Reports
*Released: July 30, 2026*

### ✨ Features

- **server**: Branding assets placed in the data directory are now served by the instance itself. ([#66](https://github.com/Skyfay/SkySend/issues/66))
- **web**: Uploads in "My Uploads" can be given an optional name. ([#67](https://github.com/Skyfay/SkySend/issues/67))

### 🔒 Security

- **server**: `CUSTOM_LOGO` no longer accepts protocol-relative URLs.

### 🐛 Bug Fixes

- **web**: A repeated wrong password on the download page shows the error again instead of staying silent.

### 📝 Documentation

- **docs**: Documented the branding directory and switched the custom logo examples to a local path.

### 🐳 Docker

- **Image**: `skyfay/skysend:v2.12.0`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64
```
