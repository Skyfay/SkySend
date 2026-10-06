# First Steps

This guide walks you through uploading and sharing your first file with SkySend.

## Upload a File

1. Open SkySend in your browser (default: [http://localhost:3000](http://localhost:3000))
2. **Drag & drop** files or a folder onto the upload zone, or use **Browse files** or **Browse folder**
3. Optionally configure:
   - **Expires after** - Pick one of the offered times
   - **Download limit** - Set it with the minus and plus buttons
   - **Password** - Optional password protection
4. Click **Encrypt and upload**. The line next to the button sums up when the upload will be deleted.
5. Wait for the encryption and upload to complete
6. Copy the share link, or open its QR code

## Share the Link

The share link looks like this:

```
https://your-instance.com/file/<id>#<secret>
```

Notes use `/note/<id>#<secret>` instead.

::: warning Important
The part after `#` is the encryption key. Anyone with this link can download and decrypt the file. Share it only with intended recipients through a secure channel.
:::

The `#` fragment is never sent to the server - it stays in the browser. This is how SkySend achieves zero-knowledge encryption.

## Multi-File Upload

SkySend supports uploading multiple files or entire folders:

1. **Multiple files** - Select multiple files in the file picker, or drag & drop several files at once
2. **Folders** - Use the folder picker or drag & drop a folder

When uploading multiple files, they are automatically zipped in your browser using [fflate](https://github.com/101arrowz/fflate) before encryption. The server only ever sees a single encrypted blob.

The recipient downloads a `.zip` file containing all original files with their names preserved.

## Download a File

1. Open the share link in your browser
2. If password-protected, enter the password
3. Click **Download**
4. The file is downloaded, decrypted in your browser, and saved to your device

## Share a Note

SkySend also shares encrypted notes, no file needed. A note is made of blocks, so text, passwords, code and SSH keys can travel together in one link.

1. Open SkySend and switch to the **Note** tab
2. Pick the block to start with:
   - **Text** - Plain text, or Markdown with a preview, rendered with full GitHub Flavored Markdown support
   - **Password** - One or more passwords, each with an optional label. Includes a built-in password generator with configurable length, character types, and entropy display.
   - **Code** - A code snippet with an optional title and syntax highlighting for over 40 languages
   - **SSH Key** - Generate an Ed25519 or RSA (1024, 2048 or 4096 bit) key pair in the browser, or paste existing keys
3. Enter your content
4. Optionally add more blocks from the **Add a block** row below the blocks. Blocks can be moved up and down and removed.
5. Optionally configure:
   - **Expires after** - How long the note should be available
   - **View limit** - Maximum number of views, from unlimited down to 1, which is burn after reading
   - **Password** - Optional password protection
6. Click **Encrypt and share**
7. Copy the share link

Empty blocks are left out of the note. The size limit applies to the whole note, and the counter in the **Add a block** row shows how much of it is used.

### View a Note

1. Open the note share link in your browser
2. If password-protected, enter the password
3. Click **View note** to decrypt and display the content
4. Each block is shown in a frame of its own with a copy button. **Copy all** copies the whole note as text.
5. If burn after reading is enabled, the note is permanently destroyed after viewing

Notes created before v3 still open, and are shown the same way.

::: warning Burn After Reading
When burn after reading is enabled, the note content is deleted from the server the moment it is viewed. There is no way to recover it.
:::

## Manage Your Uploads

SkySend stores your upload and note history locally in your browser (IndexedDB). No account is needed.

Navigate to **My Uploads** to:

- Filter by **All**, **Files**, or a note type
- View all uploads and notes you created from this browser
- See download/view count and remaining downloads/views
- See expiry countdown
- Re-copy the share link
- Open, rename or delete an upload, or show its QR code, from the **⋯** menu. Notes cannot be renamed.

::: info Browser-Local Data
Upload and note history is stored only in your browser. Switching browsers or clearing browser data will lose the list. The uploads and notes themselves remain on the server until they expire.
:::

## See How the Encryption Works

Every instance has a **How it works** page at `/how`. It shows where the key travels, what the server stores, and lets you encrypt a sample text in your own browser. The full design is in [Encryption Design](/user-guide/security/encryption).

## Upload from the Terminal

SkySend also provides a CLI client for uploading and downloading files from the terminal. It uses the same end-to-end encryption as the web interface.

```bash
# Install (Linux/macOS)
curl -fsSL https://skysend.app/install.sh | sh

# Set your server
skysend config set-server https://your-instance.com

# Upload a file
skysend upload ./document.pdf

# Download a file
skysend download https://your-instance.com/file/abc123#secret

# Create a note
skysend note "Secret message" --expires 1h
```

See the full [CLI Client documentation](/user-guide/client-cli/) for all commands and options.
