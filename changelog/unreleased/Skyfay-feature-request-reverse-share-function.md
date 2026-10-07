### ✨ Features

- **crypto**: Encryption for file requests that only the requester can open, notes sent into them included.
- **server**: File requests with an inbox, where senders upload files that only the requester can decrypt. The requester sets how long a request stays open, how many uploads it takes and how large each may be.
- **web**: A Request page to create file requests, with an upload link to hand out and an inbox link to keep, plus the inbox that lists, downloads and deletes what arrived.
- **web**: An upload page for senders of a file request, which encrypts their files for the requester alone and gives them no link back.
- **web**: A file request can ask for files, a note with a template of fields the sender fills in, or both as one submission. The inbox opens a note in the page and lists a submission together.
- **web**: A dot beside My Links and a count on each request show uploads that arrived since its inbox was last open in this browser.
- **web**: Templates keep the setup of a request for the next one, with built-in ones for credentials, an SSH key, Wi-Fi and an API key. They live in this browser and move to another one as a file or a link, sealed with a password if wanted.
- **crypto**: `sealWithPassword` and `openWithPassword` encrypt an export with a key Argon2id derives from a password.
- **web**: A field of a password block can be marked as no secret, like a username or an address, and is then shown in clear without a generator. A block with such a field is called Fields instead of Password.
- **web**: Text, password and SSH key blocks take a title of their own, like Server access, in a shared note and in a request template. It heads the block for whoever fills it in or reads it.
- **client**: Fields of a password block that are no secret show in clear in the terminal view of a note, under the title of their block.
- **cli**: `list`, `delete`, `stats`, `cleanup` and `config` cover file requests and the files uploaded into them.
- **website**: The report form accepts links to file requests.
- **infra**: The report worker accepts links to file requests.

### 🐛 Bug Fixes

- **web**: The download speed no longer shows a negative value after a download falls back to another way of saving the file.
- **server**: A WebSocket upload keeps its file when recording the upload quota fails.
- **server**: Expiry options longer than 100 years are refused at startup instead of failing every upload.

### 🔒 Security

- **server**: Chunked uploads refuse empty chunks and keep at most 64 chunks waiting for an earlier one.
- **server**: A WebSocket upload whose first frame is `null` no longer crashes the server.
- **server**: WebSocket uploads closed during setup or finalize leave no orphaned file behind, and uploads that deliver less than 1 MB in 10 minutes are closed.
- **server**: A WebSocket upload that stops short of 4 MB no longer keeps its data in memory.
- **server**: WebSocket uploads no longer send storage error details to the client.
- **web**: Downloads through the service worker tell the browser not to guess the file type.
- **cli**: `list --json` no longer prints the auth and owner tokens of uploads.
- **cli**: `config --json` masks the S3 keys and the OIDC secrets.

### 🎨 Improvements

- **web**: The German message for a file that cannot be read uses the formal address.

### 🔄 Changed

- **web**: My Uploads is now My Links, with one tab for what was shared and one for the file requests made in this browser.
- **server**: `ENABLED_SERVICES` now defaults to `file,note,request`. Instances that set it explicitly add `request` to offer file requests.
- **server**: Failed password attempts that led to no lockout are forgotten after `PASSWORD_LOCKOUT_MS`.

### 📝 Documentation

- **docs**: Environment variables for file requests.
- **docs**: The download modes page covers downloads from the inbox of a file request.
- **docs**: Pages for file requests in the user guide, the API reference and the cryptography section, request templates included.
- **docs**: The admin CLI commands page matches what the commands print.

### 🧪 Tests

- **crypto**: Tests for file requests against the official HPKE test vectors, a frozen fixture of the request format and every way to tamper with a wrapped key.
- **server**: Tests for file requests covering the tokens, the login for creating, parallel uploads into one request and the cleanup.
- **server**: Tests for WebSocket uploads that send a `null` frame, close during setup or finalize, or go silent.
- **web**: Tests for creating file requests, opening their inbox with and without a password, downloading from it and uploading into a request.
- **web**: Component tests for the note editors, a template filled in and the note viewer.
- **web**: Tests for request templates, their storage, their export with and without a password, and every way an import is refused.
- **infra**: The tests of `@skysend/crypto` and `@skysend/note-format` are typechecked along with their code.
