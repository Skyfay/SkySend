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

### End-to-End Tests
- Playwright test suite for critical user flows
- Upload -> share -> download -> verify roundtrip
- Password-protected upload flow
- Multi-file upload flow

## Nice-to-Have

### Notification on Download
- Optional notification when a file is downloaded
- Webhook or email notification

### Prometheus Metrics
- Expose `/metrics` endpoint for monitoring
- Upload count, storage usage, active uploads, download rate

## Completed

### CLI Client (v2.4.0)
- Cross-platform CLI binary for uploading and downloading files with E2E encryption
- Supports single/multi-file uploads, encrypted notes, password protection
- WebSocket and HTTP chunked transports
- Self-update mechanism with checksum verification
- Install scripts for Linux, macOS, and Windows
- Pre-built binaries compiled with Bun for 5 targets
