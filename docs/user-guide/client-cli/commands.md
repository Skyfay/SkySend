# Commands

Detailed reference for all SkySend CLI client commands.

## upload

Upload one or more files with end-to-end encryption.

```bash
skysend upload <files...> [options]
```

### Arguments

| Argument | Description |
| --- | --- |
| `<files...>` | One or more file paths to upload |

### Options

| Option | Description |
| --- | --- |
| `-s, --server <url>` | Server URL (overrides config) |
| `-e, --expires <duration>` | Expiry time (e.g. `5m`, `1h`, `1d`, `7d`) |
| `-d, --downloads <count>` | Maximum number of downloads |
| `-p, --password [password]` | Password protect the upload. Prompts interactively if no value is given. |
| `--no-ws` | Disable WebSocket transport, use HTTP chunked upload |
| `--json` | Output result as JSON |

### Examples

```bash
# Upload a single file
skysend upload ./document.pdf

# Upload with expiry and download limit
skysend upload ./report.pdf --expires 24h --downloads 5

# Upload multiple files (zipped automatically)
skysend upload ./file1.txt ./file2.txt ./file3.txt

# Upload with password (interactive prompt)
skysend upload ./secret.zip --password

# Upload with inline password
skysend upload ./secret.zip --password "my-secret"

# Upload with JSON output (for scripting)
skysend upload ./data.csv --json
```

### Upload Behavior

- **Single file**: Uploaded as-is after encryption.
- **Multiple files**: Automatically zipped with [fflate](https://github.com/101arrowz/fflate) before encryption. The recipient receives a `.zip` file.
- **Transport**: Uses WebSocket transport (primary) with automatic fallback to HTTP chunked upload if the WebSocket handshake fails. Use `--no-ws` to force HTTP chunked upload, or toggle it in Settings in interactive mode.
- **Progress**: Displays a progress bar with speed and ETA.

### JSON Output

When using `--json`, the output includes all details needed for scripting:

```json
{
  "url": "https://your-instance.com/file/abc123#base64url_secret",
  "id": "abc123",
  "ownerToken": "base64url_owner_token",
  "expiresAt": "2026-04-20T12:00:00.000Z"
}
```

::: tip Owner Token
The `ownerToken` is required to delete an upload. When using `--json`, save the output so you can delete the upload later with `skysend delete`.
:::

---

## download

Download and decrypt a file from a SkySend share URL.

```bash
skysend download <url> [options]
```

### Arguments

| Argument | Description |
| --- | --- |
| `<url>` | SkySend share URL (e.g. `https://instance.com/file/abc123#secret`) |

### Options

| Option | Description |
| --- | --- |
| `-o, --output <path>` | Output path (file or directory). Defaults to the original filename in the current directory. |
| `-p, --password [password]` | Password for protected uploads. Prompts interactively if no value is given. |
| `--json` | Output result as JSON |

### Examples

```bash
# Download a file (saves to current directory with original filename)
skysend download https://instance.com/file/abc123#secret

# Download to a specific directory
skysend download https://instance.com/file/abc123#secret --output ~/Downloads/

# Download with a specific filename
skysend download https://instance.com/file/abc123#secret --output ~/report.pdf

# Download a password-protected file (interactive prompt)
skysend download https://instance.com/file/abc123#secret --password

# Download with inline password
skysend download https://instance.com/file/abc123#secret --password "my-secret"
```

### Download Behavior

- The encryption key is extracted from the URL fragment (`#`).
- If the file is password-protected, you will be prompted for the password (or provide it via `--password`).
- Progress is displayed with a bar, speed, and ETA.
- The original filename is extracted from the encrypted metadata. For multi-file uploads, the downloaded file will be a `.zip` archive.

---

## note

Create an encrypted note.

```bash
skysend note <text> [options]
```

### Arguments

| Argument | Description |
| --- | --- |
| `<text>` | The note content |

### Options

| Option | Default | Description |
| --- | --- | --- |
| `-s, --server <url>` | | Server URL (overrides config) |
| `-t, --type <type>` | `text` | Content type: `text`, `password`, `code`, `markdown`, `sshkey` |
| `-e, --expires <duration>` | | Expiry time (e.g. `5m`, `1h`, `1d`, `7d`) |
| `-v, --views <count>` | | Maximum view count (`0` = unlimited) |
| `-p, --password [password]` | | Password protect. Prompts interactively if no value is given. |
| `--json` | | Output result as JSON |

### Examples

```bash
# Create a simple text note
skysend note "This is a secret message"

# Create a burn-after-reading note (1 view)
skysend note "One-time secret" --views 1

# Create a code snippet
skysend note "console.log('hello')" --type code --expires 1h

# Create a Markdown note
skysend note "# Hello\n\nThis is **bold**." --type markdown

# Create a password note
skysend note "admin:s3cret" --type password

# Create a password-protected note
skysend note "secret data" --password --expires 24h --views 5
```

### Content Types

| Type | Description |
| --- | --- |
| `text` | Plain text (default) |
| `password` | Password(s) displayed with masked fields and copy buttons in the web UI |
| `code` | Code with syntax highlighting and line numbers in the web UI |
| `markdown` | Rendered GitHub Flavored Markdown in the web UI |
| `sshkey` | SSH key pairs with structured display in the web UI |

::: tip
Note content types affect how the note is rendered in the **web UI**. In the terminal, `note:view` always displays the raw content.
:::

---

## note:view

View and decrypt an encrypted note.

```bash
skysend note:view <url> [options]
```

### Arguments

| Argument | Description |
| --- | --- |
| `<url>` | SkySend note share URL (e.g. `https://instance.com/note/abc123#secret`) |

### Options

| Option | Description |
| --- | --- |
| `-p, --password [password]` | Password for protected notes. Prompts interactively if no value is given. |
| `--json` | Output result as JSON |

### Examples

```bash
# View an encrypted note
skysend note:view https://instance.com/note/abc123#secret

# View a password-protected note
skysend note:view https://instance.com/note/abc123#secret --password

# View with JSON output
skysend note:view https://instance.com/note/abc123#secret --json
```

::: warning Burn After Reading
If the note has a view limit of 1 (burn-after-reading), viewing it will permanently destroy it. There is no way to view it again.
:::

---

## delete

Delete an upload or note using the owner token.

```bash
skysend delete <url> <ownerToken> [options]
```

### Arguments

| Argument | Description |
| --- | --- |
| `<url>` | SkySend share URL (file or note) |
| `<ownerToken>` | Owner token received during upload (from `--json` output) |

### Options

| Option | Description |
| --- | --- |
| `--json` | Output result as JSON |

### Examples

```bash
# Delete a file upload
skysend delete https://instance.com/file/abc123#secret AbCdEf123...

# Delete a note
skysend delete https://instance.com/note/abc123#secret AbCdEf123...
```

::: tip
To get the owner token, use `--json` when uploading:

```bash
skysend upload ./file.txt --json
# Output includes "ownerToken": "..."
```
:::

---

## ls

List upload and note history stored locally on the client.

```bash
skysend ls [options]
```

### Options

| Option | Description |
| --- | --- |
| `-s, --server <url>` | Filter by server URL |
| `-a, --all` | Show entries for all servers |
| `--json` | Output as JSON |

### Examples

```bash
# List history for the default server
skysend ls

# List history for all servers
skysend ls --all

# Filter by server
skysend ls --server https://send.example.com

# Get JSON output for scripting
skysend ls --json
```

::: tip
History is stored at `~/.config/skysend/history.json` and holds up to 100 uploads and 100 notes. Expired entries are automatically cleaned up.
:::

---

## config

Manage client configuration.

### Show Configuration

```bash
skysend config
```

Displays the config file path, the configured server URL, all registered servers with their per-server WebSocket status, and the `SKYSEND_SERVER` environment variable (if set).

### Set Server

```bash
skysend config set-server <url>
```

Save a default server URL. This is used by all commands unless overridden with `--server` or `SKYSEND_SERVER`.

```bash
skysend config set-server https://your-instance.com
```

### Reset

```bash
skysend config reset
```

Reset configuration to defaults (removes the config file).

### Config File Location

The configuration file is stored at:

- **Linux/macOS**: `~/.config/skysend/config.json`
- **Custom**: `$XDG_CONFIG_HOME/skysend/config.json`
- **Windows**: `%USERPROFILE%\.config\skysend\config.json`

---

## update

Check for updates and self-update the CLI binary.

```bash
skysend update [options]
```

### Options

| Option | Description |
| --- | --- |
| `--check` | Only check for updates without installing |

### Examples

```bash
# Check if an update is available
skysend update --check

# Update to the latest version
skysend update
```

### Update Behavior

1. Queries the GitHub Releases API for the latest version
2. Compares with the currently installed version
3. If a newer version is available, downloads the correct binary for your platform
4. Verifies the SHA-256 checksum against `checksums.txt` from the release
5. Atomically replaces the running binary

::: tip
On Linux/macOS, you may need `sudo` if the binary is installed in `/usr/local/bin`:

```bash
sudo skysend update
```

Alternatively, re-run the install script.
:::

---

## interactive (default)

Launch an interactive menu-driven mode. Fetches the server configuration and displays available options, limits, and quota information.

This is the **default command** - running `skysend` without a subcommand launches interactive mode automatically.

```bash
skysend                       # launches interactive mode
skysend interactive [options]
skysend i [options]           # short alias
```

### Options

| Option | Description |
| --- | --- |
| `-s, --server <url>` | Server URL (overrides config) |

### Features

- Displays server info: name, enabled services, max file size, upload quota
- Menu with available actions based on server capabilities
- **Upload file(s)**: interactive file path input, expiry selection, download count, password, confirmation before upload
- **Download file**: enter a share URL, auto-detects password protection, choose save location
- **Create note**: type selection (text, password, code, markdown, SSH key), content input (inline or from file with `@path`), expiry, max views, password
- **My uploads**: browse upload and note history, view share URLs, delete from server or remove from local history
- **Check for updates**: check and install newer CLI versions from GitHub Releases
- Loops back to the menu after each action until you choose Exit

### Upload History

All uploads and notes created via the CLI (both interactive and direct commands) are saved to `~/.config/skysend/history.json`. This enables the "My uploads" feature in interactive mode.

### Example

```bash
skysend interactive --server https://send.example.com
```

---

## Global Options

These options are available on all commands:

| Option | Description |
| --- | --- |
| `-V, --version` | Show the current version |
| `-h, --help` | Show help for the command |
