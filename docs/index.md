---
layout: home

hero:
  name: "SkySend"
  text: "Encrypted File Sharing"
  tagline: Minimalist, self-hostable, end-to-end encrypted file sharing. Zero knowledge - the server never sees your data.
  actions:
    - theme: brand
      text: Get Started
      link: /user-guide/getting-started
    - theme: alt
      text: Developer Guide
      link: /developer-guide/
    - theme: alt
      text: GitHub
      link: https://github.com/Skyfay/SkySend

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
    title: Optional Password Protection
    details: Protect uploads with a password using Argon2id (WASM) or PBKDF2-SHA256 as fallback. GPU-resistant key derivation.
  - icon: 📁
    title: Multi-File & Folder Uploads
    details: Upload multiple files or entire folders. Files are zipped client-side with fflate before encryption - the server sees only one encrypted blob.
  - icon: ⏱️
    title: Automatic Expiry
    details: Uploads expire automatically after a configurable time or download count. No data lingers on the server.
  - icon: 🐳
    title: Single Docker Container
    details: Self-host with a single Docker command. SQLite database, local filesystem storage, zero external dependencies.
  - icon: 🛠️
    title: Admin CLI
    details: Manage uploads, view statistics, trigger cleanup, and inspect configuration from the command line.
  - icon: 🌍
    title: Multi-Language
    details: Built-in internationalization with automatic browser language detection and English fallback.
  - icon: 📊
    title: Upload Dashboard
    details: Track your uploads locally via IndexedDB. View download counts, expiry countdowns, and re-copy share links - no account needed.
  - icon: 🛡️
    title: Privacy by Design
    details: No telemetry, no analytics, no external service dependencies. Upload quotas use HMAC-hashed IPs with daily key rotation.
  - icon: 📜
    title: Open Source (AGPLv3)
    details: Fully open source. Hosted instances must release their source code, protecting users from closed-source forks.
---

## Quick Start

Get SkySend running in seconds with Docker:

```bash
docker compose up -d
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

::: tip Zero Configuration
SkySend works out of the box with sensible defaults. No environment variables required for a basic setup.
:::
