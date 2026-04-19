# First Steps

This guide walks you through uploading and sharing your first file with SkySend.

## Upload a File

1. Open SkySend in your browser (default: [http://localhost:3000](http://localhost:3000))
2. **Drag & drop** a file onto the upload zone, or **click** to select a file
3. Optionally configure:
   - **Expiry time** - How long the upload should be available
   - **Download limit** - Maximum number of downloads
   - **Password** - Optional password protection
4. Click **Upload**
5. Wait for the encryption and upload to complete
6. Copy the share link

## Share the Link

The share link looks like this:

```
https://your-instance.com/#base64url_encoded_secret
```

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

SkySend also supports sharing encrypted text notes - no file needed.

1. Open SkySend and switch to the **Note** tab
2. Choose a note type:
   - **Text** - Plain text content, with an optional Markdown mode (live preview and rendered GFM output)
   - **Password** - One or more passwords displayed as masked fields with individual reveal and copy buttons. Includes a built-in password generator with configurable length, character types, and entropy display.
   - **Code** - Code snippets with automatic syntax highlighting (22 languages) and line numbers
   - **SSH Key** - Generate Ed25519 or RSA (1024-4096 bit) key pairs in the browser, or paste existing keys. Shared as a structured note with separate Public Key and Private Key sections.
   - **Markdown** - Available as a sub-toggle in the Text tab. Write Markdown with a live preview and view it rendered with full GitHub Flavored Markdown support.
3. Enter your content
4. Optionally configure:
   - **Expiry time** - How long the note should be available
   - **View limit** - Maximum number of views (including unlimited)
   - **Password** - Optional password protection
   - **Burn after reading** - Destroy the note after a single view
5. Click **Create Note**
6. Copy the share link

### View a Note

1. Open the note share link in your browser
2. If password-protected, enter the password
3. Click **View Note** to decrypt and display the content
4. If burn after reading is enabled, the note is permanently destroyed after viewing

::: warning Burn After Reading
When burn after reading is enabled, the note content is deleted from the server the moment it is viewed. There is no way to recover it.
:::

## Manage Your Uploads

SkySend stores your upload and note history locally in your browser (IndexedDB). No account is needed.

Navigate to **My Uploads** to:

- Filter by **All**, **Files**, or **Notes**
- View all uploads and notes you created from this browser
- See download/view count and remaining downloads/views
- See expiry countdown
- Re-copy the share link
- Delete uploads or notes manually

::: info Browser-Local Data
Upload and note history is stored only in your browser. Switching browsers or clearing browser data will lose the list. The uploads and notes themselves remain on the server until they expire.
:::

## Upload from the Terminal

SkySend also provides a CLI client for uploading and downloading files from the terminal. It uses the same end-to-end encryption as the web interface.

```bash
# Install (Linux/macOS)
curl -fsSL https://raw.githubusercontent.com/Skyfay/SkySend/main/scripts/install.sh | sh

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
