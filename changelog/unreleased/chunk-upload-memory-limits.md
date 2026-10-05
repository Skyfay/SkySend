### 🔒 Security

- **server**: Upload chunks are now streamed to disk instead of being held in memory, so oversized or parallel chunk requests can no longer exhaust the server's memory. A chunk is limited to 16 MiB and the chunks of an upload to its declared size. Thanks @rajnisht7 ([GHSA-9rmm-v3p2-c26g](https://github.com/Skyfay/SkySend/security/advisories/GHSA-9rmm-v3p2-c26g))
- **server**: WebSocket upload messages are limited to 1 MiB instead of the 100 MiB default of the WebSocket library.

### 📝 Documentation

- **docs**: Documented the limits and error responses of the chunk upload endpoint and the `tmp/` folder in the data directory.

### 🧪 Tests

- **server**: Added tests for the limits of the chunked upload and for the chunk files on disk.
