# CLI Client

SkySend includes a command-line client for uploading and downloading files with the same end-to-end encryption as the web interface. It is distributed as a single binary - no runtime dependencies required.

## Overview

The CLI client (`skysend`) lets you:

- **Upload** single or multiple files with E2E encryption
- **Download** and decrypt files from a share URL
- **Create** encrypted notes (text, password, code, markdown, SSH keys)
- **View** encrypted notes from the terminal
- **Delete** uploads and notes using the owner token
- **Self-update** to the latest version from GitHub Releases
- **Interactive mode** with menu-driven TUI - displays server config, limits, and quota

All cryptographic operations use the same `@skysend/crypto` library as the web frontend - AES-256-GCM streaming encryption, HKDF-SHA256 key derivation, and Argon2id password protection.

## Supported Platforms

| Platform | Architecture | Binary Name |
| --- | --- | --- |
| Linux | x86_64 (AMD64) | `skysend-linux-x64` |
| Linux | ARM64 (aarch64) | `skysend-linux-arm64` |
| macOS | Intel (x86_64) | `skysend-darwin-x64` |
| macOS | Apple Silicon (ARM64) | `skysend-darwin-arm64` |
| Windows | x86_64 (AMD64) | `skysend-windows-x64.exe` |

Binaries are compiled with [Bun](https://bun.sh/) and published as GitHub Release assets.

## Installation

### Linux / macOS

The install script automatically detects your OS and architecture, downloads the correct binary, verifies the SHA-256 checksum, and installs it to `/usr/local/bin`:

```bash
curl -fsSL https://raw.githubusercontent.com/Skyfay/SkySend/main/scripts/install.sh | sh
```

To install a specific version or to a custom directory:

```bash
VERSION=v2.4.0 curl -fsSL https://raw.githubusercontent.com/Skyfay/SkySend/main/scripts/install.sh | sh
INSTALL_DIR=$HOME/.local/bin curl -fsSL https://raw.githubusercontent.com/Skyfay/SkySend/main/scripts/install.sh | sh
```

### Windows

Run in PowerShell:

```powershell
irm https://raw.githubusercontent.com/Skyfay/SkySend/main/scripts/install.ps1 | iex
```

This installs `skysend.exe` to `~/.skysend/bin` and adds it to your user PATH. Restart your terminal for PATH changes to take effect.

To install a specific version:

```powershell
$env:VERSION="v2.4.0"; irm https://raw.githubusercontent.com/Skyfay/SkySend/main/scripts/install.ps1 | iex
```

### Manual Download

Download the binary for your platform from the [GitHub Releases](https://github.com/Skyfay/SkySend/releases) page, make it executable, and move it to a directory in your PATH:

```bash
chmod +x skysend-linux-x64
sudo mv skysend-linux-x64 /usr/local/bin/skysend
```

## Configuration

Before uploading, set your default SkySend server:

```bash
skysend config set-server https://your-instance.com
```

The config is stored at `~/.config/skysend/config.json` (or `$XDG_CONFIG_HOME/skysend/config.json`).

You can also set the server per-command with `--server` or via the `SKYSEND_SERVER` environment variable.

**Priority order:**

1. `--server` flag (highest)
2. `SKYSEND_SERVER` environment variable
3. Config file (`~/.config/skysend/config.json`)

### View Config

```bash
skysend config
```

### Reset Config

```bash
skysend config reset
```

## Updating

The CLI can update itself to the latest version:

```bash
# Check for updates without installing
skysend update --check

# Download and install the latest version
skysend update
```

The update command:

1. Checks the latest version from GitHub Releases
2. Downloads the correct binary for your platform
3. Verifies the SHA-256 checksum
4. Atomically replaces the running binary

::: tip
On Linux/macOS, you may need `sudo` if the binary is installed in `/usr/local/bin`. Alternatively, re-run the install script.
:::

## Quick Reference

| Command | Description |
| --- | --- |
| `skysend` | Interactive menu-driven mode (recommended) |
| `skysend upload <files...>` | Upload files with E2E encryption |
| `skysend download <url>` | Download and decrypt a file |
| `skysend note <text>` | Create an encrypted note |
| `skysend note:view <url>` | View an encrypted note |
| `skysend delete <url> <ownerToken>` | Delete an upload or note |
| `skysend config` | Show current configuration |
| `skysend config set-server <url>` | Set default server |
| `skysend config reset` | Reset configuration |
| `skysend update` | Self-update to latest version |
| `skysend --version` | Show current version |
| `skysend --help` | Show help |

See [Commands](/user-guide/client-cli/commands) for detailed usage of each command.
