# Contributing to SkySend

Thank you for your interest in contributing!

## Development Setup

### Prerequisites

- Node.js 24 LTS or later
- pnpm 9 or later

### Getting Started

```bash
git clone https://github.com/skyfay/skysend.git
cd skysend
pnpm install
pnpm dev
```

This starts both the backend (Hono) and frontend (Vite) in development mode.

### Project Structure

```
apps/
  server/    # Hono backend (API + static file serving)
  web/       # React SPA (Vite + Shadcn UI)
  cli/       # Admin CLI tool
packages/
  crypto/    # Shared encryption library (Web Crypto API)
docs/        # VitePress documentation
```

### Commands

```bash
pnpm dev          # Start development servers
pnpm build        # Build all packages
pnpm test         # Run all tests
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

- One feature/fix per PR
- Include tests for new functionality
- Update documentation if relevant
- Ensure all CI checks pass

## Security

If you discover a security vulnerability, **do not** open a public issue. Instead, please report it responsibly by contacting the maintainer directly.

## Philosophy

Please read [PHILOSOPHY.md](PHILOSOPHY.md) before proposing new features. Contributions that conflict with the project philosophy will be respectfully declined.
