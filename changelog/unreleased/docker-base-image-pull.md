### 🔒 Security

- **docker**: The image runs on Node 24.22.1 or later, which fixes the Brotli decoder flaw CVE-2026-111497 of earlier Node releases.

### 🔧 CI/CD

- **infra**: The release build always pulls the latest `node:24-alpine` base image instead of relying on a cached one.
