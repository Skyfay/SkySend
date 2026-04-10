# Developer Guide

Welcome to the SkySend developer documentation. This guide covers the codebase architecture, development setup, and technical details for contributors.

## Project Overview

SkySend is a monorepo managed with pnpm Workspaces, consisting of:

| Package | Path | Description |
| --- | --- | --- |
| `@skysend/server` | `apps/server` | Hono-based REST API |
| `@skysend/web` | `apps/web` | React SPA (Vite + Shadcn UI) |
| `@skysend/cli` | `apps/cli` | Admin CLI tool |
| `@skysend/crypto` | `packages/crypto` | Shared encryption library |
| `@skysend/docs` | `docs` | VitePress documentation |

## Tech Stack

| Area | Technology |
| --- | --- |
| Runtime | Node.js 24 LTS |
| Backend | Hono |
| Frontend | Vite + React 19 + Shadcn UI |
| ORM | Drizzle ORM |
| Database | SQLite (via better-sqlite3) |
| Crypto | Web Crypto API (native) |
| Validation | Zod |
| i18n | react-i18next |
| Password KDF | Argon2id (WASM) + PBKDF2-SHA256 fallback |
| Zip | fflate |
| Monorepo | pnpm Workspaces |
| Tests | Vitest |

## Quick Links

- [Architecture](/developer-guide/architecture) - System architecture and data flow
- [Project Setup](/developer-guide/setup) - Set up a local development environment
- [API Reference](/developer-guide/api/) - REST API documentation
- [Cryptography](/developer-guide/crypto/) - Encryption library details
- [Database Schema](/developer-guide/reference/schema) - SQLite schema reference
