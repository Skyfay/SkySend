<div align="center">
  <img src="https://raw.githubusercontent.com/Skyfay/SkySend/main/docs/public/logo.svg" alt="SkySend Logo" width="120">
</div>

<h1 align="center">SkySend</h1>

<p align="center">
  <strong>End-to-end encrypted, self-hostable file and note sharing, built for speed and security.</strong>
</p>

<p align="center">
  <a href="https://github.com/Skyfay/SkySend/actions/workflows/release.yml"><img src="https://github.com/Skyfay/SkySend/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://hub.docker.com/r/skyfay/skysend"><img src="https://img.shields.io/docker/pulls/skyfay/skysend?logo=docker&logoColor=white" alt="Docker Pulls"></a>
  <a href="https://codecov.io/gh/Skyfay/SkySend"><img src="https://img.shields.io/codecov/c/github/Skyfay/SkySend?label=coverage" alt="Coverage"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License"></a>
  <a href="https://discord.com/invite/YvgPyky"><img src="https://img.shields.io/discord/580801656707350529?label=Discord&color=%235865f2" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://skysend.app">Website</a> •
  <a href="https://docs.skysend.app">Documentation</a> •
  <a href="https://docs.skysend.app/user-guide/getting-started">Quick Start</a> •
  <a href="https://docs.skysend.app/instances">Public Instances</a> •
  <a href="https://docs.skysend.app/changelog">Changelog</a> •
  <a href="https://skysend.app/roadmap/">Roadmap</a>
</p>

<!-- Premium Sponsors ($500 a month): their logo at the very top, linking to their site. Kept by hand,
     uncomment and fill in, one link per sponsor:
<p align="center">
  <sub>🏆 Premium Sponsors · $500 a month</sub>
  <br>
  <a href="https://example.com"><img src="https://example.com/logo.svg" alt="Company" height="60"></a>
</p>
-->

<div align="center">
  <img src="https://raw.githubusercontent.com/Skyfay/SkySend/main/docs/public/readme-banner.png" alt="The SkySend share page on a desktop and the download page on a phone" width="800">
</div>

### What is SkySend?

SkySend shares files and notes so that only the recipient can read them. Everything is encrypted in the browser before it leaves the device, and the key travels in the fragment of the share link, which browsers never send to a server. The server stores ciphertext and nothing else.

It runs as one Docker container with SQLite and needs no accounts. Host your own instance, or use one of the [public instances](https://docs.skysend.app/instances), and if you run one yourself, you can [add it to the list](https://docs.skysend.app/instances).

Inspired by [timvisee/send](https://github.com/timvisee/send), the community fork of Mozilla Send, and by [PrivateBin](https://privatebin.info/), SkySend is built from scratch with higher security standards, more features and a minimal, maintainable codebase. Its whole crypto design is [documented](https://docs.skysend.app/developer-guide/crypto/).

## ✨ Highlights

- **Zero knowledge** - AES-256-GCM in the browser, and the key never leaves the share link
- **Files and folders** - single files, several at once or a whole folder, zipped in the browser, with size and file limits you set yourself
- **Notes made of blocks** - text and Markdown, passwords with a generator, code with highlighting and SSH keys, combined in one note
- **Shares that delete themselves** - expiry times, download and view limits, and burn after reading
- **Password protection** - an optional password on top of the link, derived with Argon2id
- **A CLI for the terminal** - upload, download and notes with the same encryption, plus an interactive TUI
- **No accounts** - My Uploads lives in the browser, and optional OIDC sign-in limits who may share
- **Runs anywhere** - local storage or any S3-compatible bucket, 13 languages and three themes

## 🔒 Security Design

| Component | Algorithm |
| :--- | :--- |
| Secret key | 256-bit random, in the URL fragment only |
| Key derivation | HKDF-SHA256, a separate key for content, metadata and auth |
| File encryption | AES-256-GCM, streamed in 64 KB records |
| Note and metadata encryption | AES-256-GCM with a random IV |
| Auth token | HMAC-SHA256 |
| Password KDF | Argon2id (WASM) |

## 🚀 Quick Start

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
```

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). The documentation covers [every environment variable](https://docs.skysend.app/user-guide/configuration/environment-variables), [reverse proxies](https://docs.skysend.app/user-guide/self-hosting/reverse-proxy) and [S3 storage](https://docs.skysend.app/user-guide/configuration/s3). Images are built for AMD64 and ARM64.

The [CLI client](https://docs.skysend.app/user-guide/client-cli/) installs with one line, on Linux and macOS:

```bash
curl -fsSL https://skysend.app/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://skysend.app/install.ps1 | iex
```

## 💖 Sponsors

SkySend is free and open source. [Sponsoring it](https://github.com/sponsors/Skyfay) keeps it that way, and from $15 a month or $100 once your name shows up here by itself.

<!-- Company Sponsors ($150 a month): their logo shown large, linking to their site. Kept by hand,
     uncomment and fill in, one link per sponsor:
<p align="center">
  <strong>🏢 Company Sponsors</strong> · $150 a month
  <br><br>
  <a href="https://example.com"><img src="https://example.com/logo.svg" alt="Company" height="80"></a>
</p>
-->

<p align="center">
  <a href="https://github.com/sponsors/Skyfay">
    <img src="https://raw.githubusercontent.com/Skyfay/DBackup/sponsors/sponsors.svg" alt="The monthly sponsors of SkySend" width="800">
  </a>
</p>

### One-time Sponsors

<!-- Patrons ($500 once): the image below draws them with their avatar. Kay sponsored while this
     tier still came with a logo, so his stays here by hand and the image leaves him out. -->
<p align="center">
  <strong>🏆 Patrons</strong> · $500 once
  <br><br>
  <a href="https://www.ictwebsolution.nl"><img src="https://ictwebsolution.nl/wp-content/uploads/2021/05/Logo-ICTWebSolution.png" alt="ICT WebSolution" height="60"></a>
  <br>
  <a href="https://www.ictwebsolution.nl"><sub>Kay van Aarssen</sub></a>
</p>

<p align="center">
  <a href="https://github.com/sponsors/Skyfay">
    <img src="https://raw.githubusercontent.com/Skyfay/DBackup/sponsors/sponsors-onetime.svg" alt="The one-time sponsors of SkySend" width="800">
  </a>
</p>

<!-- The two images are drawn every night by the Sponsors workflow of Skyfay/DBackup, which publishes
     the GitHub Sponsors of Skyfay to its sponsors branch for both READMEs. -->

## 🛠️ Contributing

Pull requests go into the `dev` branch, never into `main`. [CONTRIBUTING.md](CONTRIBUTING.md) explains the setup and the workflow, and the [Developer Guide](https://docs.skysend.app/developer-guide/) the architecture, the crypto library and the tests. Please read [PHILOSOPHY.md](PHILOSOPHY.md) before proposing a feature.

## 💬 Community & Support

- 💬 **Discord**: [dc.skyfay.ch](https://dc.skyfay.ch)
- 🐛 **Issues**: bugs and feature requests on [GitHub Issues](https://github.com/Skyfay/SkySend/issues)
- 📧 **Support**: [support@skysend.app](mailto:support@skysend.app)
- 🔒 **Security**: report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), never in a public issue

## 🤖 AI Development Transparency

The architecture, the cryptographic design, the technology stack and the feature specifications of SkySend were designed and directed by a human system engineer. The code is written by AI coding agents that follow those specifications and the guidelines of the project. Every feature is tested by hand, backed by unit tests with coverage tracking, CodeQL and security audits.

A manual security audit by an external developer has not been done yet. The crypto design is [publicly documented](https://docs.skysend.app/developer-guide/crypto/) to make an independent review easy. If you review code or work in security, your findings are very welcome, see [SECURITY.md](SECURITY.md) for how to report them.

## 📝 License

[GNU Affero General Public License v3.0](LICENSE). Any hosted instance must release its source code.
