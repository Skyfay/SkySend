> ⚠️ **Before updating:** `S3_PRESIGNED_EXPIRY` now accepts at most `900` seconds. A server with a higher value refuses to start until it is lowered.

### 🔒 Security

- **server**: Presigned S3 download URLs now live for 60 seconds by default instead of 300 and never past the expiry of the upload, which narrows the window in which a captured URL can be fetched beyond the download limit. Thanks @tasa1 ([GHSA-ghcm-gq78-wggw](https://github.com/Skyfay/SkySend/security/advisories/GHSA-ghcm-gq78-wggw))
- **server**: `S3_PRESIGNED_EXPIRY` accepts at most 900 seconds. Thanks @tasa1 ([GHSA-ghcm-gq78-wggw](https://github.com/Skyfay/SkySend/security/advisories/GHSA-ghcm-gq78-wggw))

### 📝 Documentation

- **docs**: The architecture page and the environment variable reference explain that a presigned S3 URL works until it expires, so the download limit on S3 holds only up to that window.
