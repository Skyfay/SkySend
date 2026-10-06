> ⚠️ **Breaking:** CLI clients before v3 cannot open notes created with v3. Update the CLI client together with the server.

### ✨ Features

- **web**: A note is made of blocks, so text, passwords, code and SSH keys can be shared together in any order. The note tab starts with a card for each block type, and blocks can be added, moved and removed.
- **client**: The CLI client opens notes made of blocks and creates them on servers from v3 on. On an older server it still creates notes in the format that server knows.
- **server**: `/api/config` reports `noteBlocks`, so a client can tell whether the server accepts notes made of blocks.
- **server**: `DEFAULT_TAB` accepts `note`, and `text`, `password`, `code` or `sshkey` open the note tab with that block already added.

### 🎨 Improvements

- **web**: Every part of a received note is shown in a frame of its own with a copy button, and code blocks can be folded one by one.
- **web**: A note that cannot be read in its format is shown as it arrived instead of failing, so a note that deleted itself on opening is not lost.

### 🔄 Changed

- **web**: The share form has two tabs, Datei and Notiz, instead of one tab per note type.
- **server**: Notes created since v3 are stored with the content type `blocks`, so the server no longer learns whether a note holds text, a password, code or an SSH key.

### 📝 Documentation

- **docs**: The config endpoint shows its current response, and the notes API documents the `blocks` content type and the 32-byte salt.

### 🧪 Tests

- **infra**: Tests for the note format, including every format a note from before v3 can have.
- **crypto**: Notes encrypted before v3 are kept as test fixtures, so a change that stops them from opening fails the tests. They cover every note type, a note password and the older 16-byte salt.
- **server**: Tests for notes made of blocks, the note tab in `DEFAULT_TAB` and the `noteBlocks` flag.
- **web**: Tests for opening notes made of blocks and notes from before v3, for code highlighting against injected markup, and for copying to the clipboard.
- **client**: Tests for turning CLI input into a note, for the format sent to older servers and for a round trip through the real encryption.
- **web**: Tests for building a note from its blocks, for the upload that only tells the server it is made of blocks, and for the kinds kept for My Uploads.

### 🔧 CI/CD

- **infra**: The note format the web app and the CLI client share is a workspace package of its own, built and covered in CI, in the Docker image and for the CLI binaries.
