# Contributing to SkySend

Contributions are welcome! Before submitting a pull request, please:

1. Check existing issues and discussions to avoid duplicates
2. For significant changes, open an issue first to discuss the approach
3. More information can be found in the [Developer Guide](https://docs.skysend.app/developer-guide/) for setup instructions

Small fixes (language translations, typos, documentation improvements) can be submitted directly as PRs.

## Branches

| Branch | What it holds |
| :--- | :--- |
| `main` | The released code. Each release merges `dev` into `main` and is tagged `vX.Y.Z` |
| `dev` | Everything that is finished, waiting for the next release |
| Feature branches | One feature or fix each, branched off `dev` |

**Pull requests go into `dev`, never into `main`.** Branch off `dev`, and open the pull request against `dev`. Only the maintainer merges `dev` into `main` for a release.

## Development Setup

### Prerequisites

- Node.js 24, the version CI and the Docker image use
- pnpm 10

### Getting Started

```bash
git clone https://github.com/Skyfay/SkySend.git
cd SkySend
git checkout dev
pnpm install
cp .env.dev.example .env.dev
pnpm dev
```

This starts both the backend (Hono) and frontend (Vite) in development mode. The server reads `.env.dev`, which git ignores, so change values there. `.env.dev.example` is its template and the one to update when a variable is added. On macOS, `bash scripts/setup-dev-macos.sh` installs Node, pnpm and the dependencies and creates `.env.dev` as well.

Start your work on a branch of its own:

```bash
git checkout -b fix/short-description dev
```

Working from a fork, add this repository as `upstream` and branch off `upstream/dev`, so your branch starts from the newest state.

### Project Structure

```
apps/
  server/    # Hono backend (API + static file serving)
  web/       # React SPA (Vite + Shadcn UI)
  cli/       # Admin CLI tool
  client/    # Official CLI client for uploads and notes
packages/
  crypto/    # Shared encryption library (Web Crypto API)
docs/        # VitePress documentation
website/     # Next.js marketing site
workers/     # Cloudflare Workers for the instance list and abuse reports
```

### Commands

```bash
pnpm dev          # Start development servers
pnpm build        # Build all packages
pnpm validate     # Run all tests (unit, lint, typecheck)
pnpm lint         # Run linters
pnpm typecheck    # Run TypeScript type checks
pnpm test         # Run unit tests
```

## Guidelines

### Code

- Write TypeScript, no `any` unless absolutely necessary
- Keep functions small and focused
- No unnecessary abstractions - if it is used once, inline it
- Test crypto code thoroughly

### Commits

- Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, etc.
- Keep commits focused on a single change

### Pull Requests

- Open it against `dev`. A pull request against `main` is retargeted or closed
- One feature/fix per PR
- Include tests for new functionality
- Update documentation if relevant
- Write the changelog entry into a file of its own under `changelog/unreleased/`, named after your branch, never into `docs/changelog.md`. The release collects those files, see [changelog/unreleased/README.md](changelog/unreleased/README.md)
- Ensure all CI checks pass. Every pull request into `dev` or `main` runs lint, type check, unit tests and the builds of the docs and the website

## Security

If you discover a security vulnerability, **do not** open a public issue or pull request. See [SECURITY.md](SECURITY.md) for how to report it privately.

## Philosophy

Please read [PHILOSOPHY.md](PHILOSOPHY.md) before proposing new features. Contributions that conflict with the project philosophy will be respectfully declined.
