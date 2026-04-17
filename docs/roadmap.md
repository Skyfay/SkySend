# Roadmap

This page outlines planned features and improvements for SkySend. Features are subject to change based on community feedback and priorities.

## In Progress

### Docker & Deployment Hardening
- Finalize multi-stage Dockerfile (optimize layers, `.dockerignore`)
- Docker Compose health check
- Graceful shutdown improvements
- Production optimizations (compression, caching headers)

## Planned

### Limits
- Download Speed Limit for filesystem (s3 does not need this)

### Load Argon2id WASM in Frontend
- Integrate Argon2id WASM for password protection in the browser
- Automatic fallback to PBKDF2-SHA256 if WASM is unavailable

### End-to-End Tests
- Playwright test suite for critical user flows
- Upload -> share -> download -> verify roundtrip
- Password-protected upload flow
- Multi-file upload flow

## Nice-to-Have

### CLI Upload Tool
- Command-line client for uploading files directly
- Useful for scripting and automation

### Notification on Download
- Optional notification when a file is downloaded
- Webhook or email notification

### Prometheus Metrics
- Expose `/metrics` endpoint for monitoring
- Upload count, storage usage, active uploads, download rate
