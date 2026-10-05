### 🐛 Bug Fixes

- **client**: The macOS binaries are now signed, so macOS on Apple Silicon no longer stops them as soon as they start. A macOS installation that does not start has to run the install script once more, since `skysend update` cannot run either.

### 🔧 CI/CD

- **infra**: A pull request into `main` now also builds the CLI binaries for all five platforms and starts them once, after the same approval as the Docker image.
