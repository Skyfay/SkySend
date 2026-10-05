### 🔒 Security

- **server**: Oversized upload chunks can no longer exhaust the server's memory, as a chunk is now cut off at 16 MiB or the declared upload size and all uploads together hold at most 512 MiB of chunks (GHSA-9rmm-v3p2-c26g).
- **server**: WebSocket upload messages are limited to 1 MiB instead of the 100 MiB default of the WebSocket library.

### 📝 Documentation

- **docs**: Documented the size limits and the error responses of the chunk upload endpoint.

### 🧪 Tests

- **server**: Added tests for every memory limit of the chunked upload.
