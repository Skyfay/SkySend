### 🐛 Bug Fixes

- **client**: `skysend upload --no-ws` is now read correctly, so it keeps uploads on HTTP chunks once WebSocket uploads return to the CLI.

### 📝 Documentation

- **docs**: The CLI docs now state that uploads always use HTTP chunks, since WebSocket uploads are disabled in the CLI.

### 🧪 Tests

- **client**: Added a test for the transport the upload command picks with and without `--no-ws`.
