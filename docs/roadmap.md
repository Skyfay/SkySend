# Roadmap

This page outlines planned features and improvements for SkySend. Features are subject to change based on community feedback and priorities.

## In Progress

### Docker & Deployment Hardening
- Finalize multi-stage Dockerfile (optimize layers, `.dockerignore`)
- Docker Compose health check
- Graceful shutdown improvements
- Production optimizations (compression, caching headers)

### Documentation
- VitePress documentation site
- Self-hosting instructions (Docker, reverse proxy)
- Configuration reference
- Crypto design documentation (public audit material)
- API documentation

## Planned

### Security Hardening
- Content Security Policy (CSP) headers
- HSTS, X-Frame-Options, and other security headers
- CORS configuration review
- Input sanitization review
- Crypto code security review
- `robots.txt` and `security.txt`

### Load Argon2id WASM in Frontend
- Integrate Argon2id WASM for password protection in the browser
- Automatic fallback to PBKDF2-SHA256 if WASM is unavailable

### End-to-End Tests
- Playwright test suite for critical user flows
- Upload -> share -> download -> verify roundtrip
- Password-protected upload flow
- Multi-file upload flow

### CI/CD Pipeline
- GitHub Actions: lint + test on PR
- GitHub Actions: build + push Docker image to GHCR
- Semantic versioning + changelog automation
- Dependabot configuration

## Nice-to-Have

### QR Code Sharing
- Generate QR code for share links
- Useful for cross-device transfers

### CLI Upload Tool
- Command-line client for uploading files directly
- Useful for scripting and automation

### Notification on Download
- Optional notification when a file is downloaded
- Webhook or email notification

### Custom Branding
- Configurable site title (already supported via `SITE_TITLE`)
- Custom logo and favicon support
- Custom colors/theme

### S3 Storage Backend
- Alternative storage backend using S3-compatible object storage
- For users who need external storage

### Prometheus Metrics
- Expose `/metrics` endpoint for monitoring
- Upload count, storage usage, active uploads, download rate
