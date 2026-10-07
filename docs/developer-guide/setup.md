# Project Setup

Set up a local development environment for SkySend.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 LTS or later
- [pnpm](https://pnpm.io/) 10
- [Git](https://git-scm.com/)
- Linux, macOS or Windows on x64 or arm64, the platforms the SQLite driver of the server ships prebuilt binaries for

## Clone and Install

```bash
git clone https://github.com/Skyfay/SkySend.git
cd SkySend
git checkout dev
pnpm install
```

New work happens on a branch off `dev`, and its pull request goes back into `dev`, never into `main`. See [Branches and Pull Requests](/developer-guide/#branches-and-pull-requests).

## Development

Start all packages in development mode:

```bash
pnpm dev
```

This runs all workspaces in parallel:
- **Server** (`apps/server`) - Hono dev server with hot reload
- **Web** (`apps/web`) - Vite dev server with HMR
- **Docs** (`docs`) - VitePress dev server

### CLI Client Development

The CLI client is not started by `pnpm dev` since it is a command-line tool, not a server. To develop and test it:

```bash
# Run a command directly with tsx (no build needed)
pnpm --filter @skysend/client run -- upload ./test-file.txt

# Build TypeScript
pnpm --filter @skysend/client build

# Compile to binary (current platform)
pnpm --filter @skysend/client build:compile

# Compile for a specific target
pnpm --filter @skysend/client build:macos-arm64
```

## Build

Build all packages:

```bash
pnpm build
```

## Run Tests

```bash
pnpm test
```

Tests are written with Vitest. Each package has its own test directory:
- `packages/crypto/tests/` - Crypto library tests
- `apps/server/tests/` - Server tests
- `apps/client/` - CLI client (use `pnpm --filter @skysend/client run` for manual testing)

## Linting & Formatting

```bash
# Lint
pnpm lint

# Lint with auto-fix
pnpm lint:fix

# Format
pnpm format

# Check formatting
pnpm format:check

# Type check
pnpm typecheck
```

## Monorepo Structure

SkySend uses pnpm Workspaces:

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "docs"
```

All packages share a root `tsconfig.json` and ESLint configuration. Each package has its own `package.json` and `tsconfig.json` for package-specific settings.

## Key Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start all packages in dev mode |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Run ESLint with auto-fix |
| `pnpm format` | Format with Prettier |
| `pnpm format:check` | Check formatting |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm --filter @skysend/client run -- <args>` | Run CLI client in dev mode |

## Code Conventions

- **Language**: TypeScript (strict mode, avoid `any`)
- **Package Manager**: pnpm (never npm or yarn)
- **Validation**: Zod for all data validation
- **Modules**: ES modules (`"type": "module"`)
- **i18n**: All user-facing strings use i18next
- **Style**: Prefer `const` over `let`, keep functions short
