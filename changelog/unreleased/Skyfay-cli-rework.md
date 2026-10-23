### ✨ Features

- **client**: The interactive mode is rebuilt as a full screen app with tabs for sending, receiving, notes, your links and settings, in the colors of the web app and the accent color of the server. Every screen works the same way with the arrows, enter and esc, and a tab keeps what was picked while another one is open.
- **client**: The first start of the interactive mode offers the public instances from instances.skysend.app and a field for your own server.
- **client**: Folders go up as a zip that keeps their structure, from `skysend upload` and from the new file dialog of the interactive mode.
- **client**: After an upload the interactive mode shows the link as a QR code and as a link that opens with a click, and copies it to the clipboard, over SSH too.
- **client**: Uploads in the interactive mode show the time left and a curve of the speed, and can be cancelled.
- **client**: A note from the interactive mode can hold several parts, like text, passwords and code together, the same as from the web app.
- **client**: `skysend upload --to` and the Send tab send files and folders into a file request from its upload link.
- **client**: `skysend inbox` lists and saves what arrived in a file request, and the Receive tab opens its inbox to download, read and delete uploads.

### 🐛 Bug Fixes

- **client**: Uploading several files packs them while they upload instead of in memory or in a temporary file first.
- **client**: A zip of several files above 4 GiB opens in every zip tool.
- **client**: An upload on a slow connection no longer reads the file into memory faster than it can send it.
- **client**: Uploads larger than about 640 MB no longer fail with a 502 behind Nginx.
- **client**: Two files of the same name sent together both arrive, the second one as `report (2).pdf`.
- **client**: Expiry times read "1 day" and "1 hour" instead of "1 days" and "1 hours".
- **client**: The CLI no longer crashes when it cannot open a browser for a login, like on a server without a desktop or over SSH.
- **client**: A file name made of a long run of dots no longer holds up a download while it is cleaned.
- **client**: Errors printed with `--json` and the address of a login stay free of color codes in the binary where `FORCE_COLOR` is set, as in many CI runners.
- **client**: `skysend delete` also takes the upload or note off the local history, so `skysend ls` and My links no longer list it.

### 🔒 Security

- **client**: Uploads name the stream nonce in their encrypted metadata and downloads check it, so a server can no longer reorder the encrypted records of a file unnoticed.
- **client**: On Windows the CLI opens the browser without `cmd.exe`, which could run a command hidden in the address of a server, and it opens web addresses only.
- **client**: The login in the browser returns to a random local address only that login knows, so another program or a web page can no longer slip in a session of another account.
- **client**: `skysend inbox --json` cleans the names inside a zip like every other name a sender wrote.
- **client**: Slashes at the end of a server address come off in linear time, so a crafted address can no longer hold up the CLI.

### 🎨 Improvements

- **client**: `upload --json` also prints whether the upload went over the WebSocket or over HTTP chunks.

### 🔄 Changed

- **client**: Uploads take the WebSocket again when the server offers it, with HTTP chunks as the fallback. `--no-ws` and the setting per server in the TUI keep an upload on HTTP chunks.
- **client**: Several files go into a zip stored without compression, the same as from the web app.

### 📝 Documentation

- **docs**: The CLI pages describe the new interactive mode, folders, the WebSocket transport, the checks of a download and every field of `upload --json`.
- **docs**: The developer guide has a page on the transfer core that the web app and the CLI share, and the architecture, setup and testing pages name it.
- **docs**: The Nginx example buffers downloads in memory instead of turning buffering off, which slowed some downloads to a fraction of their speed. Change existing configs the same way.

### 🧪 Tests

- **server**: Tests read the answers of the real routes with the client the web app and the CLI share, so a change the clients would no longer read fails before a release.
- **infra**: The transfer benchmark measures the CLI as well as the browser, and uploads of several files at once.
- **infra**: End-to-end tests cover the CLI logging in through OIDC and sending over the WebSocket, folders and zips of several files between the browser and the CLI, file requests from both sides, and run against the Bun binary with `E2E_CLI=binary`.
- **infra**: The API client the web app and the CLI share has tests of its own for every route, the tokens each one sends and what it makes of errors, older servers and downloads from S3.
- **infra**: The end-to-end tests give a busy Docker daemon up to 90 seconds to answer before they call it missing, since a runner still clearing its disk took longer than the 10 seconds before.

### 🔧 CI/CD

- **infra**: The end-to-end jobs keep the Playwright browsers in a cache and start the browser install again when the Ubuntu mirror stalls, instead of waiting half an hour on it.
- **infra**: The web app and the CLI share one package for uploads, downloads, notes, links, file requests and the API of the server, built and tested with the other packages in CI, the Docker image and the release.
