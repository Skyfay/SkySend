### ✨ Features

- **server**: The new `STORAGE_MAX_SIZE` caps the space all stored files of an instance may take, on the filesystem and on S3. An upload that does not fit is refused before any data is sent. ([#88](https://github.com/Skyfay/SkySend/issues/88))
- **web**: An upload refused because the instance is out of storage space shows a translated message. ([#88](https://github.com/Skyfay/SkySend/issues/88))

### 📝 Documentation

- **docs**: Documented `STORAGE_MAX_SIZE` and the `507` answer of the upload routes. ([#88](https://github.com/Skyfay/SkySend/issues/88))
