### ✨ Features

- **server**: `/api/config` reports `noteBlocks`, so a client can tell whether the server accepts notes made of blocks.
- **server**: `DEFAULT_TAB` accepts `note`, and `text`, `password`, `code` or `sshkey` open the note tab with that block already added.

### 🔄 Changed

- **server**: Notes created since v3 are stored with the content type `blocks`, so the server no longer learns whether a note holds text, a password, code or an SSH key.

### 📝 Documentation

- **docs**: The config endpoint shows its current response, and the notes API documents the `blocks` content type and the 32-byte salt.

### 🧪 Tests

- **infra**: Tests for the note format, including every format a note from before v3 can have.
- **crypto**: Notes encrypted before v3 are kept as test fixtures, so a change that stops them from opening fails the tests. They cover every note type, a note password and the older 16-byte salt.
- **server**: Tests for notes made of blocks, the note tab in `DEFAULT_TAB` and the `noteBlocks` flag.

### 🔧 CI/CD

- **infra**: The note format the web app and the CLI client share is a workspace package of its own, built and covered in CI, in the Docker image and for the CLI binaries.
