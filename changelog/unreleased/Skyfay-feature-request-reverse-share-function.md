### ✨ Features

- **crypto**: Encryption for file requests that only the requester can open.
- **server**: File requests with an inbox, where senders upload files that only the requester can decrypt. The requester sets how long a request stays open and how many uploads and bytes it takes.
- **web**: A Requests page to create file requests, with an upload link to hand out and an inbox link to keep, plus the inbox that lists, downloads and deletes what arrived.
- **web**: An upload page for senders of a file request, which encrypts their files for the requester alone and gives them no link back.
- **cli**: `list`, `delete`, `stats`, `cleanup` and `config` cover file requests and the files uploaded into them.
- **website**: The report form accepts links to file requests.
- **infra**: The report worker accepts links to file requests.

### 🐛 Bug Fixes

- **web**: The download speed no longer shows a negative value after a download falls back to another way of saving the file.

### 🔒 Security

- **server**: Chunked uploads refuse empty chunks and keep at most 64 chunks waiting for an earlier one.
- **server**: A WebSocket upload whose first frame is `null` no longer crashes the server.
- **server**: WebSocket uploads closed during setup or finalize leave no orphaned file behind, and uploads that stay silent for 10 minutes are closed.
- **server**: WebSocket uploads no longer send storage error details to the client.
- **web**: Downloads through the service worker tell the browser not to guess the file type.
- **cli**: `list --json` no longer prints the auth and owner tokens of uploads.
- **cli**: `config --json` masks the S3 keys and the OIDC secrets.

### 🎨 Improvements

- **web**: The German message for a file that cannot be read uses the formal address.

### 🔄 Changed

- **server**: `ENABLED_SERVICES` now defaults to `file,note,request`. Instances that set it explicitly add `request` to offer file requests.
- **server**: Failed password attempts that led to no lockout are forgotten after `PASSWORD_LOCKOUT_MS`.

### 📝 Documentation

- **docs**: Environment variables for file requests.
- **docs**: The download modes page covers downloads from the inbox of a file request.
- **docs**: Pages for file requests in the user guide, the API reference and the cryptography section.
- **docs**: The admin CLI commands page matches what the commands print.

### 🧪 Tests

- **crypto**: Tests for file requests against the official HPKE test vectors, a frozen fixture of the request format and every way to tamper with a wrapped key.
- **server**: Tests for file requests covering the tokens, the login for creating, parallel uploads into one request and the cleanup.
- **server**: Tests for WebSocket uploads that send a `null` frame, close during setup or finalize, or go silent.
- **web**: Tests for creating file requests, opening their inbox with and without a password, downloading from it and uploading into a request.
