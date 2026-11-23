### ✨ Features

- **server**: The new `STORAGE_MAX_SIZE` caps the space all stored files of an instance may take, on the filesystem and on S3. An upload that does not fit is refused before any data is sent. ([#88](https://github.com/Skyfay/SkySend/issues/88))
- **server**: The server warns at startup when `STORAGE_MAX_SIZE` is set without an upload quota or below the maximum file size. ([#88](https://github.com/Skyfay/SkySend/issues/88))
- **server**: `/api/config` reports `storageLow` while the storage limit has less room left than the maximum file size, without revealing the used or free space. ([#88](https://github.com/Skyfay/SkySend/issues/88))
- **web**: An upload refused for lack of free storage shows a translated message of its own, apart from the file size errors. ([#88](https://github.com/Skyfay/SkySend/issues/88))
- **web**: The upload page and the page for sending files into a file request show a notice while the instance is low on storage, so a large upload may be refused even below its size limit. ([#88](https://github.com/Skyfay/SkySend/issues/88))

### 📝 Documentation

- **docs**: Documented `STORAGE_MAX_SIZE` with its startup warnings, the `507` answer of the upload routes and the `storageLow` field of `/api/config`. ([#88](https://github.com/Skyfay/SkySend/issues/88))
