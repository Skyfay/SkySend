# Commands

Detailed reference for all SkySend CLI client commands.

## upload

Upload one or more files or folders with end-to-end encryption.

```bash
skysend upload <files...> [options]
```

### Arguments

| Argument | Description |
| --- | --- |
| `<files...>` | One or more files or folders to upload |

### Options

| Option | Description |
| --- | --- |
| `-s, --server <url>` | Server URL (overrides config) |
| `-e, --expires <duration>` | Expiry time (e.g. `5m`, `1h`, `1d`, `7d`) |
| `-d, --downloads <count>` | Maximum number of downloads |
| `-p, --password [password]` | Password protect the upload, at least 8 characters. Prompts interactively if no value is given. |
| `--no-ws` | Use HTTP chunked upload instead of WebSocket, see below |
| `--json` | Output result as JSON |

### Examples

```bash
# Upload a single file
skysend upload ./document.pdf

# Upload with expiry and download limit
skysend upload ./report.pdf --expires 24h --downloads 5

# Upload multiple files (zipped automatically)
skysend upload ./file1.txt ./file2.txt ./file3.txt

# Upload a folder with everything in it
skysend upload ./photos

# Upload with password (interactive prompt)
skysend upload ./secret.zip --password

# Upload with inline password
skysend upload ./secret.zip --password "my-secret"

# Upload with JSON output (for scripting)
skysend upload ./data.csv --json
```

### Upload Behavior

- **Single file**: Read from the disk and encrypted while it uploads, so the memory stays flat whatever the size.
- **Multiple files**: Packed into one `.zip` while they upload, stored without compression like the web app does, with ZIP64 above 4 GiB. Two files of the same name both arrive, the second as `report (2).pdf`. The recipient receives the `.zip` file.
- **Folders**: Every file below a folder goes into the zip under its path from the folder, like `photos/2026/beach.jpg`. Links to other folders are skipped. The server's limit on files per upload counts the files inside.
- **Transport**: WebSocket when the server offers it, with HTTP chunks as the fallback when the WebSocket cannot connect. `--no-ws` stays on HTTP chunks, see [WebSocket Transport](./index.md#websocket-transport).
- **Progress**: Displays a progress bar with speed and ETA.

### JSON Output

When using `--json`, the output includes all details needed for scripting:

```json
{
  "id": "abc123",
  "url": "https://your-instance.com/file/abc123#base64url_secret",
  "ownerToken": "base64url_owner_token",
  "size": 1048576,
  "encryptedSize": 1048844,
  "fileCount": 1,
  "expires": 86400,
  "maxDownloads": 1,
  "hasPassword": false,
  "transport": "ws"
}
```

`size` is the plaintext in bytes, the zip for several files, and `expires` is in seconds. `transport` is `ws` or `http`, whichever carried the upload.

::: tip Owner Token
The `ownerToken` is required to delete an upload. When using `--json`, save the output so you can delete the upload later with `skysend delete`.
:::

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
| `-o, --output <path>` | Output path (file or directory). Defaults to the original filename in the current directory. The filename is cleaned of path separators, control characters and leading dots, and a file that already exists keeps its place while the download gets a number, such as `report (1).pdf`. Only an explicit file path replaces an existing file. |
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
- The file is decrypted while it downloads and checked against the size in the encrypted metadata and against its stream nonce, which every upload from the web app and from this version of the CLI names. A server that cuts or reorders the encrypted data then fails the download.
- It is written to a hidden `.skysend-<id>.part` file next to the target first and renamed at the end, so a download that breaks off never leaves a file that looks complete.

## note

Create an encrypted note.

```bash
skysend note [text] [options]
```

### Arguments

| Argument | Description |
| --- | --- |
| `[text]` | The note content. Leave it out, or pass `-`, to type it at a prompt or pipe it in |

::: warning Keep secrets out of the command line
A note given as an argument stays in your shell history, and on Linux other users of the machine can read it from the process list while the command runs. For a password or any other secret, leave the argument out: the CLI asks for a note of one line without showing it, and reads a note that spans lines from a pipe or a file.
:::

### Options

| Option | Default | Description |
| --- | --- | --- |
| `-s, --server <url>` | | Server URL (overrides config) |
| `-t, --type <type>` | `text` | Note type: `text`, `password`, `code`, `markdown`, `sshkey` |
| `-e, --expires <duration>` | | Expiry time (e.g. `5m`, `1h`, `1d`, `7d`) |
| `-v, --views <count>` | | Maximum view count (`0` = unlimited) |
| `-p, --password [password]` | | Password protect, at least 8 characters. Prompts interactively if no value is given. |
| `--json` | | Output result as JSON |

### Examples

```bash
# Type a secret note at a prompt that does not show it
skysend note --type password

# Read a note from a file or a pipe
skysend note --type sshkey < ~/.ssh/deploy_key
pbpaste | skysend note --type code

# Create a simple text note
skysend note "This is a secret message"

# Create a burn-after-reading note (1 view)
skysend note "One-time secret" --views 1

# Create a code snippet
skysend note "console.log('hello')" --type code --expires 1h

# Create a Markdown note
skysend note "# Hello\n\nThis is **bold**." --type markdown

# Create a password-protected note, both typed at prompts
skysend note --password --expires 24h --views 5
```

### Note Types

The CLI creates a note of one block. Notes that combine several blocks can be created in the web app.

| Type | Description |
| --- | --- |
| `text` | Plain text (default) |
| `password` | The whole text as one password, shown masked with a copy button |
| `code` | Code with syntax highlighting and line numbers in the web UI |
| `markdown` | Text rendered as GitHub Flavored Markdown in the web UI |
| `sshkey` | SSH key material. A public key, a private key and a `Passphrase:` line in the text are shown as separate parts. |

::: tip Older servers
A server before v3 does not know notes made of blocks. The CLI client detects this and creates the note in the format that server knows, so the note opens in its web UI as before.
:::

## note:view

View and decrypt an encrypted note in the interactive TUI.

```bash
skysend note:view <url>
```

### Arguments

| Argument | Description |
| --- | --- |
| `<url>` | SkySend note share URL (e.g. `https://instance.com/note/abc123#secret`) |

### Examples

```bash
# View an encrypted note
skysend note:view https://instance.com/note/abc123#secret
```

If the note is password-protected, the TUI prompts for the password. Each block of the note is shown in a frame of its own. Passwords stay hidden until "Show the passwords". `page down` and `page up` scroll a long note, "Copy the note" copies it and "Save it to a file" saves the whole note. The file is created so that only you can read it. Control characters in a note, which could hide text or change the terminal, are shown as `�`.

Notes made of blocks need a CLI client from v3 on. Notes created before v3 open in every version.

::: warning Burn After Reading
If the note has a view limit of 1 (burn-after-reading), viewing it will permanently destroy it. There is no way to view it again.
:::

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

## auth

Manage OIDC authentication sessions for a server. When a server has OIDC enabled and requires authentication for file uploads or note creation, the CLI opens a browser automatically. Use the `auth` commands to manage sessions explicitly.

### auth login

```bash
skysend auth login [options]
```

Starts a browser-based OIDC login for the configured server. A temporary local server is started to receive the callback, and your default browser is opened automatically. After completing the login, the session token is saved to `~/.config/skysend/tokens.json` and reused for future commands until it expires.

#### Options

| Option | Description |
| --- | --- |
| `-s, --server <url>` | Server URL (overrides config) |

#### Example

```bash
skysend auth login
skysend auth login --server https://send.company.com
```

### auth logout

```bash
skysend auth logout [options]
```

Removes the stored session token for a server. The next upload or note command will require a fresh login.

#### Options

| Option | Description |
| --- | --- |
| `-s, --server <url>` | Server URL (overrides config) |

#### Example

```bash
skysend auth logout
skysend auth logout --server https://send.company.com
```

### auth status

```bash
skysend auth status [options]
```

Shows the current session status for a server - the authenticated user's name, email, and when the session expires.

#### Options

| Option | Description |
| --- | --- |
| `-s, --server <url>` | Server URL (overrides config) |

#### Example

```bash
skysend auth status
```

Output:

```
Server:  https://send.company.com
User:    Jane Doe <jane@company.com>
Expires: 5/15/2026, 10:30:00 AM
Status:  active
```

### How OIDC auth works

When you run `skysend upload` or `skysend note` on an OIDC-protected server:

1. The CLI fetches the server config and detects that OIDC is required
2. It checks `~/.config/skysend/tokens.json` for a valid, non-expired token
3. If none exists, it starts a local callback server, opens your browser, and waits
4. You complete login in the browser - the server redirects back to the local server with the session token
5. The token is saved and the upload/note creation continues automatically

In the **interactive TUI mode**, a "Waiting for browser login..." screen is shown during this step.

::: tip Token Storage
Session tokens are stored per-server in `~/.config/skysend/tokens.json` with `600` file permissions (owner read/write only). Tokens are JWT session tokens issued by the SkySend server - they are not your OIDC provider credentials.
:::

## interactive (default)

Starts the interactive mode, a full screen app in the terminal with tabs for everything the CLI does. It takes the colors of the dark theme of the web app and the accent color of the server, SkySend green before a server is chosen. Quitting gives the terminal back as it was.

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

### First start

Without a configured server, the first screen offers the public instances listed on [instances.skysend.app](https://instances.skysend.app/) with their country and limits, your saved servers, and a field for the address of your own server. The server you pick there is saved, and the first one becomes the default, so the next start goes straight to it. A server given with `--server` is used without being saved.

### Keys

Every screen is one list of rows with one cursor, and the keys do the same everywhere. The bar at the bottom shows what enter does on the row the cursor is on.

| Key | What it does |
| --- | --- |
| `↑` `↓` | Move the cursor. `tab` and `shift+tab` do the same. |
| `enter` | Do what the row says: press a button, open an entry, go on from a field. |
| `←` `→` | Change a value, shown as `‹ 1 day ›`. In the tab bar they switch tabs. |
| typing | Goes into the field the cursor is on, like a path, a password or a note. Pasting works the same. |
| `space` | Selects a file or a whole folder in the file dialog. |
| `del` | Takes a file out before sending, or forgets a saved server. |
| `esc` | Goes back: from a dialog to the tab, from the tab up to the tab bar. |
| `q`, `ctrl+c` | Quit. `q` works in the tab bar, `ctrl+c` everywhere. |

The tab bar is the top row. `esc`, or `↑` on the first row of a tab, moves the cursor up there, `←` `→` switch tabs and `↓` goes back in. A tab keeps what you picked or typed, and an upload or download runs on while you look at another tab.

### Tabs

| Tab | What it does |
| --- | --- |
| **Send** | Pick files or folders, or type or paste a path, set when it expires, how many downloads it allows and a password, then press Send. During the upload a bar shows the amount, the time left and a curve of the speed, and "Cancel the upload" stops it after a second enter. Afterwards the link is shown with a QR code, with buttons to copy it, open it and send more. |
| **Receive** | Paste a file or a note link and it opens. A file shows its name, size and the files in its zip, asks for the password when it has one, and downloads to the current folder or the place you type under "Save to". A note opens on the screen with buttons to show its passwords, copy it and save it to a file. |
| **Note** | Creates a note: text, passwords, code, markdown or an SSH key. `←` `→` on "Kind of note" picks the kind. Text is written in the editor or loaded from a file, passwords are typed or made with "Make a strong password", an SSH key is made on the spot or read from a file. |
| **My links** | The uploads and notes sent from this computer. `enter` opens one with its link, QR code, its downloads or views and the time left on the server, and buttons to copy, open, delete it from the server or take it off the list. |
| **Settings** | Switches the server, picks the one to start with, turns fast WebSocket uploads off for this server and forgets saved servers. |

Links on the screen open with a click in terminals that support hyperlinks, also where a link wraps over two lines.

### Picking files

"Pick files or folders" opens a file dialog: "Go to" jumps to places such as Home, Desktop and Downloads, "Filter" narrows the folder to names you type, and the folder is listed below. `space` selects a file or a whole folder, `→` opens a folder and `←` goes up. `enter` is done: it moves the cursor to the button on top, which shows how many files are selected and how large they are together, across folders, and a second `enter` adds them. Before anything is selected, `enter` opens a folder or takes the file it is on.

A folder goes up as a zip that keeps its structure, so `trip/day-1/photo.jpg` arrives under that name. On a desktop computer, dropping files on the terminal window pastes their paths, and the Send tab adds them.

### Copying the link

"Copy the link" puts it on the clipboard with the tool of the system: `pbcopy` on macOS, `clip` on Windows, `wl-copy`, `xclip` or `xsel` on Linux. It also sends the link to the terminal as an OSC 52 sequence, which most terminals put on the clipboard of the computer in front of you, so copying works over SSH too. The message at the top right says whether a tool of the system took it. The link with its key never appears in the process list.

### Upload History

All uploads and notes created via the CLI (both interactive and direct commands) are saved to `~/.config/skysend/history.json`. This enables the "My uploads" feature in interactive mode. The history holds the full share links with their keys and the owner tokens, so the CLI keeps it, the config and the OIDC session readable for your user only (file mode `0600` in a `0700` folder), and narrows files an older version created with wider permissions.

### Example

```bash
skysend interactive --server https://send.example.com
```

## Global Options

These options are available on all commands:

| Option | Description |
| --- | --- |
| `-V, --version` | Show the current version |
| `-h, --help` | Show help for the command |
