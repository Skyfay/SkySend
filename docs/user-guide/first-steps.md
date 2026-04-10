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

## Manage Your Uploads

SkySend stores your upload history locally in your browser (IndexedDB). No account is needed.

Navigate to **My Uploads** to:

- View all uploads you made from this browser
- See download count and remaining downloads
- See expiry countdown
- Re-copy the share link
- Delete uploads manually

::: info Browser-Local Data
Upload history is stored only in your browser. Switching browsers or clearing browser data will lose the upload list. The uploads themselves remain on the server until they expire.
:::
