### 🧪 Tests

- **server**: Tests now cover the origin check of WebSocket uploads, every rule of the `cli_callback` check of the CLI login and the owner token check of a deletion. Mutation testing showed that each of them could break without a failing test.
- **client**: The tests now run with a temporary home folder, so a test that falls back to the home folder can no longer write into the real `~/.config/skysend` of whoever runs them.

### 🗑️ Removed

- **server**: Removed the unused `authMiddleware`. The download route has checked the auth token with its own lockout-aware middleware for a while.
