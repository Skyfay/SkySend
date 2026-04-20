---
layout: home

hero:
  name: "SkySend"
  text: "Encrypted File & Note Sharing"
  tagline: Minimalist, self-hostable, end-to-end encrypted file and note sharing. Zero knowledge - the server never sees your data.
  actions:
    - theme: brand
      text: User Guide
      link: /user-guide/getting-started
    - theme: alt
      text: Developer Guide
      link: /developer-guide/
    - theme: alt
      text: Instances
      link: /instances

features:
  - icon: 🔒
    title: End-to-End Encryption
    details: AES-256-GCM streaming encryption with HKDF-SHA256 key derivation. The server never has access to plaintext data.
  - icon: 🧠
    title: Zero Knowledge
    details: The encryption key lives only in the URL fragment (#) and never leaves the browser. The server is intentionally blind.
  - icon: 👤
    title: No Accounts Required
    details: No registration, no login, no tracking. Upload a file, get a link, share it. That's it.
  - icon: 🔑
    title: Password Protection
    details: Protect uploads with a password using Argon2id (WASM) or PBKDF2-SHA256 as fallback. GPU-resistant key derivation.
  - icon: 📁
    title: Multi-File & Folder Uploads
    details: Upload multiple files or entire folders. Files are zipped client-side with fflate before encryption - the server sees only one encrypted blob.
  - icon: 📝
    title: Encrypted Notes
    details: Share text, passwords, code, Markdown, or SSH keys - all end-to-end encrypted. Supports burn-after-reading, view limits, and password protection.
  - icon: ⏱️
    title: Automatic Expiry
    details: Uploads and notes expire automatically after a configurable time or download/view count. No data lingers on the server.
  - icon: 📊
    title: Upload Dashboard
    details: Track your uploads and notes locally via IndexedDB. View download/view counts, expiry countdowns, and re-copy share links - no account needed.
  - icon: 🛠️
    title: Admin CLI
    details: Manage uploads, view statistics, trigger cleanup, and inspect configuration from the command line inside the container.
  - icon: 💻
    title: CLI Client
    details: Upload and download files from the terminal with full E2E encryption. Pre-built binaries for Linux, macOS, and Windows with self-update support.
  - icon: ☁️
    title: S3 Storage Support
    details: Optional S3-compatible storage backend for Cloudflare R2, AWS S3, MinIO, and more. Serve files via public URL or presigned URLs.
  - icon: 🐳
    title: Docker Ready
    details: Multi-arch images (AMD64/ARM64), built-in health checks, graceful shutdown, and configurable PUID/PGID.
  - icon: 🌍
    title: Multi-Language
    details: Built-in internationalization with automatic browser language detection and English fallback.
  - icon: 🛡️
    title: Privacy by Design
    details: No telemetry, no analytics, no external service dependencies. Upload quotas use HMAC-hashed IPs with daily key rotation.
  - icon: 📜
    title: Open Source (AGPLv3)
    details: Fully open source. Hosted instances must release their source code, protecting users from closed-source forks.
---


## Quick Start

Get SkySend running in seconds with Docker:

::: code-group

```yaml [Docker Compose]
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
      # All environment variables: https://docs.skysend.ch/user-guide/configuration/environment-variables
      # There are a lot of customization options available, so make sure to check the documentation for more details.
```

```bash [Docker Run]
docker run -d --name skysend -p 3000:3000 \
  -e BASE_URL=http://localhost:3000 \
  -v "$(pwd)/data:/data" \
  -v "$(pwd)/uploads:/uploads" \
  skyfay/skysend:latest
```

:::

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## CLI Client

Upload and download files from the terminal with end-to-end encryption:

::: code-group

```bash [Linux / macOS]
curl -fsSL https://skysend.ch/install.sh | sh
```

```powershell [Windows (PowerShell)]
irm https://skysend.ch/install.ps1 | iex
```

:::

```bash
skysend config set-server https://your-instance.com
skysend upload ./document.pdf
skysend download https://your-instance.com/file/abc123#secret
```

See the full [CLI Client documentation](/user-guide/client-cli/) for all commands and options.

## 💬 Community & Support

- 💬 **Discord**: Join our community at [https://dc.skyfay.ch](https://dc.skyfay.ch)
- 📝 **Documentation**: Full guides and API reference at [docs.skysend.ch](https://docs.skysend.ch)
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
