### 🧪 Tests

- **infra**: Tests for the note format, including every format a note from before v3 can have.
- **crypto**: Notes encrypted before v3 are kept as test fixtures, so a change that stops them from opening fails the tests. They cover every note type, a note password and the older 16-byte salt.

### 🔧 CI/CD

- **infra**: The note format the web app and the CLI client share is a workspace package of its own, built and covered in CI, in the Docker image and for the CLI binaries.
