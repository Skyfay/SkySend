### 🧪 Tests

- **server**: Tests for errors in the middle of an upload, like a storage or database failure at the start or the finalize, for the session layer of chunked uploads and for the inbox and WebSocket paths of file requests.
- **client**: Tests for a temporary file that cannot be created, a stream that delivers text and a file name with an extension too long to keep.
