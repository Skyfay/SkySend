### 🔒 Security

- **server**: A burst of parallel guesses no longer gets past the password lockout of files, notes and inboxes.
- **server**: WebSocket upload messages are limited to 320 KiB, and a connection that stops in the middle of one is closed after 150 seconds.
- **server**: Parts of uploads to S3 that are still filling up count against a memory limit and wait on disk beyond it, so many slow uploads can no longer exhaust the memory of the server.
- **server**: Responses of the login routes are no longer cached.
- **crypto**: The decryption stream can check the base nonce of a file against the one in the encrypted metadata.
- **web**: Uploads keep the base nonce of the file in the encrypted metadata, and downloads refuse a file whose records the server reordered.
- **web**: Long Markdown in a note is shown as plain text, so a crafted note can no longer freeze the page.
- **web**: Cleaning a file name from a sender no longer takes quadratic time on names full of dots and spaces.
- **infra**: The instances worker reads at most 64 KiB from each instance and keeps only values of the expected type and size, so one instance can no longer stop the list from refreshing.

### 📝 Documentation

- **docs**: Documented the base nonce in the metadata, the S3 part files in the data directory and the new WebSocket limits.
- **docs**: Added recommended values of `S3_MEMORY_LIMIT` for many simultaneous uploads on a server with one core.
- **docs**: Added minimal, recommended and enterprise system requirements with measured throughput to the installation guide.
