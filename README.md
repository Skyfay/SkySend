<div align="center">
  <img src="https://raw.githubusercontent.com/Skyfay/SkySend/main/docs/public/logo.svg" alt="SkySend Logo" width="120">
</div>

<h1 align="center">SkySend</h1>

<p align="center">
  <strong>Minimalist, end-to-end encrypted, self-hostable file sharing service.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License">
  <img src="https://img.shields.io/docker/pulls/skyfay/skysend?logo=docker&logoColor=white" alt="Docker Pulls">
  <img src="https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/self--hosted-yes-%239B59B6" alt="Self-hosted">
  <img src="https://img.shields.io/badge/open_source-%E2%9D%A4%EF%B8%8F-red" alt="Open Source">
  <br>
  <a href="https://github.com/Skyfay/SkySend/actions/workflows/release.yml"><img src="https://github.com/Skyfay/SkySend/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://github.com/Skyfay/SkySend/commits"><img src="https://img.shields.io/github/last-commit/Skyfay/SkySend?color=%234B8BBE" alt="Last Commit"></a>
  <a href="https://discord.com/invite/YvgPyky"><img src="https://img.shields.io/discord/580801656707350529?label=Discord&color=%235865f2" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://skysend.ch">Website</a> •
  <a href="https://docs.skysend.ch">Documentation</a> •
  <a href="https://docs.skysend.ch/user-guide/getting-started">Quick Start</a> •
  <a href="https://docs.skysend.ch/instances">Public Instances</a> •
  <a href="https://docs.skysend.ch/changelog">Changelog</a> •
  <a href="https://docs.skysend.ch/roadmap">Roadmap</a>
</p>

### What is SkySend?

SkySend is a minimalist, self-hostable file sharing service with end-to-end encryption. Files are encrypted entirely in the browser using AES-256-GCM before they ever reach the server - the server stores only encrypted blobs and never has access to the decryption key.

No accounts required. No telemetry. No external dependencies. Just upload a file, get a link, share it. Links expire automatically after a configurable time or number of downloads.

Inspired by [timvisee/send](https://github.com/timvisee/send) (the community fork of Mozilla Send), SkySend is built from scratch with higher security standards and a minimal, maintainable codebase.

<div align="center">
  <img src="https://raw.githubusercontent.com/Skyfay/SkySend/main/docs/public/screenshots/overview.png" alt="SkySend Screenshot" width="800">
</div>

## ✨ Features

### 🔒 End-to-End Encryption

- **AES-256-GCM** streaming encryption with 64KB record size
- **HKDF-SHA256** key derivation with domain-separated keys (fileKey, metaKey, authKey)
- **Zero Knowledge** - the encryption key lives only in the URL fragment (`#`) and never leaves the browser
- **Argon2id** password protection via WASM with PBKDF2-SHA256 fallback

### 📁 Upload & Sharing

- **Drag & Drop** - files and folders
- **Multi-File Upload** - up to 32 files per upload, zipped client-side with fflate
- **Folder Upload** - entire directories via the folder picker
- **Configurable Expiry** - choose download limits and expiration times
- **Password Protection** - optional, GPU-resistant key derivation
- **Share Links** - copy and share with one click

### 📊 Upload Dashboard

- **No Account Needed** - upload history stored locally in IndexedDB
- **Live Status** - download counts, remaining downloads, expiry countdowns
- **Manage Uploads** - re-copy share links or delete uploads
- **Auto-Cleanup** - expired entries removed automatically

### 🐳 Docker Ready

- **Single Container** - deploy with `docker compose up -d`
- **Multi-Arch** - AMD64 and ARM64 images
- **Health Checks** - built-in health endpoint at `/api/health`
- **Configurable UID/GID** - `PUID`/`PGID` for proper volume permissions
- **Graceful Shutdown** - handles SIGTERM cleanly

### 🛠️ Admin CLI

- **`skysend-cli list`** - show active uploads
- **`skysend-cli delete <id>`** - delete an upload
- **`skysend-cli stats`** - storage overview
- **`skysend-cli cleanup`** - trigger manual cleanup
- **`skysend-cli config`** - show current configuration

### 🌍 Additional

- **Multi-Language** - automatic browser language detection with English fallback
- **Dark Mode** - with automatic OS detection
- **Rate Limiting** - sliding window, per-IP
- **Upload Quota** - privacy-preserving with HMAC-hashed IPs and daily key rotation
- **Responsive** - mobile and desktop

## 🚀 Quick Start

**Supported Platforms**: AMD64 (x86_64) • ARM64 (aarch64)

```yaml
# docker-compose.yml
services:
  skysend:
    image: skyfay/skysend:latest
    container_name: skysend
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
      - ./uploads:/uploads
    environment:
      - BASE_URL=http://localhost:3000
      - PUID=1000
      - PGID=1000
      # All environment variables: https://docs.skysend.ch/user-guide/configuration/environment-variables
```

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

📖 **Full installation guide**: [docs.skysend.ch/user-guide/getting-started](https://docs.skysend.ch/user-guide/getting-started)

## 🔒 Security Design

| Component | Algorithm |
| :--- | :--- |
| Secret Key | 256-bit Random (32 Bytes) |
| Key Derivation | HKDF-SHA256 |
| File Encryption | AES-256-GCM, 64KB Record Size |
| Metadata Encryption | AES-256-GCM + Random IV |
| Nonce Handling | Counter-based (XOR) |
| Auth Token | HMAC-SHA256 |
| Password KDF | Argon2id (WASM) / PBKDF2-SHA256 (600k iterations) |

The complete crypto design is publicly documented at [docs.skysend.ch/developer-guide/crypto](https://docs.skysend.ch/developer-guide/crypto/).

## 🛠️ Tech Stack

| Area | Technology |
| :--- | :--- |
| Runtime | Node.js 24 LTS |
| Backend | Hono |
| Frontend | Vite + React 19 + Shadcn UI |
| Database | SQLite (Drizzle ORM) |
| Crypto | Web Crypto API + Argon2id (WASM) |
| Validation | Zod |
| i18n | react-i18next |
| Docs | VitePress |
| Monorepo | pnpm Workspaces |

## 📚 Documentation

Full documentation is available at **[docs.skysend.ch](https://docs.skysend.ch)**:

- [User Guide](https://docs.skysend.ch/user-guide/getting-started) - Installation, configuration, usage
- [Developer Guide](https://docs.skysend.ch/developer-guide/) - Architecture, crypto design, contributing
- [Changelog](https://docs.skysend.ch/changelog) - Release history
- [Roadmap](https://docs.skysend.ch/roadmap) - Planned features

## 🛠️ Development

```bash
# Clone & install
git clone https://github.com/Skyfay/SkySend.git && cd SkySend
pnpm install

# Start dev server (all packages in parallel)
pnpm dev

# Run all checks (lint, typecheck, tests)
pnpm validate
```

For contribution guidelines, see the [Developer Guide](https://docs.skysend.ch/developer-guide/) and [CONTRIBUTING.md](CONTRIBUTING.md).

## 💬 Community & Support

- 💬 **Discord**: Join our community at [https://dc.skyfay.ch](https://dc.skyfay.ch)
- 📝 **Documentation**: Full guides at [docs.skysend.ch](https://docs.skysend.ch)
- 🐛 **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/Skyfay/SkySend/issues)
- 📧 **Support**: General questions and support via [support@skysend.ch](mailto:support@skysend.ch)
- 🔒 **Security**: Report vulnerabilities responsibly via [security@skysend.ch](mailto:security@skysend.ch) (please do **not** open public issues for security reports)

## 🤖 AI Development Transparency

### Architecture & Concept

The system architecture, cryptographic design, strict technology stack selection, and feature specifications for SkySend were entirely conceptualized and directed by a human System Engineer to solve real-world privacy challenges in file sharing.

### Implementation

The application code was generated by AI coding agents following detailed architectural specifications and coding guidelines. All features were manually tested for correctness, stability, and real-world reliability. Automated unit tests (Vitest) and static security audits complement the manual QA process.

### Open for Review

SkySend is thoroughly tested and used in production, but a formal manual security audit by an external developer has not yet been completed. The entire cryptographic design is [publicly documented](https://docs.skysend.ch/developer-guide/crypto/) to facilitate independent review. If you are a software developer or cybersecurity professional, your expertise is highly welcome! We invite the open-source community to review the code, submit PRs, and help us elevate SkySend to a fully verified standard.

> **Security Disclosure**: If you discover a security vulnerability, please **do not** open a public GitHub issue. Instead, report it responsibly via email to **[security@skysend.ch](mailto:security@skysend.ch)**.

## 📝 License

[GNU Affero General Public License v3.0](LICENSE) - Any hosted instance must release its source code.
