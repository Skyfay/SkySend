### 🔒 Security

- **crypto**: Sizes in decrypted metadata must be whole numbers, and file names, MIME types and archive entry lists have an upper bound.
- **server**: Uploads and notes are only created with auth and owner tokens of exactly 32 bytes.
- **web**: The download service worker passes on a MIME type only when it starts with a letter.

### 🎨 Improvements

- **crypto**: The encrypt stream hands out a copy of its nonce header, and the owner token derivation checks the salt length like the key derivation does.

### 📝 Documentation

- **docs**: The owner token comes from the secret in the link, so a link holder can also delete a share, and the security pages now say so.

### 🧪 Tests

- **crypto**: Frozen values pin the auth and owner token derivation, the password box key is checked to be non-extractable, and the base64url decoder is checked to refuse the standard alphabet.
