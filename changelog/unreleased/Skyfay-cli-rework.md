### 🐛 Bug Fixes

- **client**: Uploading several files packs them while they upload instead of in memory or in a temporary file first.
- **client**: A zip of several files above 4 GiB opens in every zip tool.
- **client**: An upload on a slow connection no longer reads the file into memory faster than it can send it.
- **client**: Uploads larger than about 640 MB no longer fail with a 502 behind Nginx.
- **client**: Two files of the same name sent together both arrive, the second one as `report (2).pdf`.
- **client**: The TUI saves a download to the edited save path instead of the one it first suggested.
- **client**: The option lists of a TUI upload start on the server's default instead of where the list before left the cursor.

### 🔒 Security

- **client**: Uploads name the stream nonce in their encrypted metadata and downloads check it, so a server can no longer reorder the encrypted records of a file unnoticed.

### 🎨 Improvements

- **client**: `upload --json` also prints whether the upload went over the WebSocket or over HTTP chunks.

### 🔄 Changed

- **client**: Uploads take the WebSocket again when the server offers it, with HTTP chunks as the fallback. `--no-ws` and the setting per server in the TUI keep an upload on HTTP chunks.
- **client**: Several files go into a zip stored without compression, the same as from the web app.

### 📝 Documentation

- **docs**: The CLI pages describe the WebSocket transport, the packing of several files, the checks of a download and every field of `upload --json`.

### 🧪 Tests

- **server**: Tests read the answers of the real routes with the client the web app and the CLI share, so a change the clients would no longer read fails before a release.
- **infra**: The transfer benchmark measures the CLI as well as the browser, and uploads of several files at once.

### 🔧 CI/CD

- **infra**: The web app and the CLI share one package for uploads, downloads and the API of the server, built and tested with the other packages in CI, the Docker image and the release.
