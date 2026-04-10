# Project Setup

Set up a local development environment for SkySend.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 LTS or later
- [pnpm](https://pnpm.io/) 9+
- [Git](https://git-scm.com/)

## Clone and Install

```bash
git clone https://github.com/Skyfay/SkySend.git
cd SkySend
pnpm install
```

## Development

Start all packages in development mode:

```bash
pnpm dev
```

This runs all workspaces in parallel:
- **Server** (`apps/server`) - Hono dev server with hot reload
- **Web** (`apps/web`) - Vite dev server with HMR
- **Docs** (`docs`) - VitePress dev server

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

## Code Conventions

- **Language**: TypeScript (strict mode, avoid `any`)
- **Package Manager**: pnpm (never npm or yarn)
- **Validation**: Zod for all data validation
- **Modules**: ES modules (`"type": "module"`)
- **i18n**: All user-facing strings use i18next
- **Style**: Prefer `const` over `let`, keep functions short
