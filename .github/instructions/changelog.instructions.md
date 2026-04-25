---
applyTo: "**/changelog.md"
---

# Changelog Format Instructions

## Entry Format

Every changelog entry uses a **bold scope prefix** followed by a description:

```
- **scope**: Description of the change (1-2 sentences max)
```

### Scopes

Use these scopes to indicate which part of the monorepo is affected:

| Scope | When to use |
|---|---|
| `server` | Backend API, database, storage, middleware (`apps/server`) |
| `web` | Frontend UI, components, hooks, pages (`apps/web`) |
| `client` | CLI client binary (`apps/client`) |
| `cli` | Admin CLI commands (`apps/cli`) |
| `crypto` | Crypto library - encryption, key derivation (`packages/crypto`) |
| `docs` | Documentation site (`docs/`) |
| `docker` | Dockerfile, docker-compose, entrypoint |
| `infra` | CI/CD, monorepo config, ESLint, TypeScript, build tooling |

If a change spans multiple scopes, pick the most relevant one. Do not list multiple scopes per entry - write separate entries instead.

## Section Headings

Entries are grouped under emoji-prefixed `###` headings within each version. Only include sections that have entries. Sections must appear in **exactly this order** - never rearrange:

| Order | Section | Use for |
|---|---|---|
| 1 | `### ✨ Features` | New features, new capabilities |
| 2 | `### 🐛 Bug Fixes` | Bug fixes for already released functionality |
| 3 | `### 🔒 Security` | Security-related changes |
| 4 | `### 🎨 Improvements` | Performance, UX, quality improvements |
| 5 | `### 🔄 Changed` | Changed behavior (non-breaking) |
| 6 | `### 🗑️ Removed` | Removed features, deprecated code |
| 7 | `### 📝 Documentation` | Documentation changes |
| 8 | `### 🧪 Tests` | Tests added or changed |
| 9 | `### 🔧 CI/CD` | CI/CD pipeline changes |
| 10 | `### 🐳 Docker` | Docker image info (always last) |

Do **not** invent new sections. Use exactly these headings.

## Version Header Format

```markdown
## vX.Y.Z - Short Title
*Released: Month Day, Year*
```

Use `*Release: In Progress*` for unreleased versions.

## Breaking Changes

Breaking changes get a blockquote with a warning directly below the release date (before any sections):

```markdown
> ⚠️ **Breaking:** Description of what breaks and migration steps.
```

## Docker Section

Every version that has a published Docker image includes a `### 🐳 Docker` section as the **last section**:

```markdown
### 🐳 Docker

- **Image**: `skyfay/skysend:vX.Y.Z`
- **Also tagged as**: `latest`, `v1` (or `beta` for pre-releases)
- **Platforms**: linux/amd64, linux/arm64
```

Tag rules:
- **Stable releases** (no suffix): `latest` + major version tag (e.g., `v1`)
- **Beta releases** (`-beta` suffix): `beta`
- **Dev releases** (`-dev` suffix): `dev`

## Bug Fix Policy

Only log bug fixes for issues in **already released versions**. Do not create bug fix entries for problems discovered and fixed during active development of an unreleased feature. If a feature is being built and a problem is found and fixed before release, that is part of the feature work - not a separate bug fix.

Examples:
- Adding a footer link feature, the icon import breaks the page, you fix it in the same session -> **not** a bug fix, part of the feature
- A user reports that downloads fail on Safari after v1.0.0 was released -> **bug fix**
- A test fails during development of a new upload flow -> **not** a bug fix
- Rate limiting stopped working after a dependency update in production -> **bug fix**

## Rules

1. **Scoped entries** - Every entry starts with `**scope**:` to identify the affected package/area.
2. **One line per entry** - Each entry is a single bullet point. Max 1-2 sentences. If you need more than two sentences, you are including too much detail - cut it.
3. **No implementation details** - No file paths, function names, or technical internals. Those belong in git commits.
4. **Chronological order** - Newest version at the top.
5. **No separators** - Do not add `---` between versions. VitePress renders them automatically.
6. **Docker section last** - `### 🐳 Docker` is always the final section in a version block.
7. **Omit empty sections** - Only include section headings that have at least one entry.
8. **Grouped sections** - Entries are organized under `###` section headings, not a flat list.
9. **Keep it short** - A changelog is a summary, not a design document. The entry should answer "what changed and why" in one or two sentences. Root causes and implementation strategies belong in git commits or pull request descriptions, not here.
