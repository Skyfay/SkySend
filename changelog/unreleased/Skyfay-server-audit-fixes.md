### 🔒 Security

- **server**: A single unauthenticated upgrade request with a malformed target, or one whose connection the client reset, no longer crashes the server, and upgrade requests outside the two WebSocket upload routes are refused with 400.
- **server**: A HEAD request to a download route is refused with 405 instead of counting a download and leaving the file open until the next restart.
- **server**: Routes that read a JSON body refuse any other content type with 415, so another website can no longer lock a visitor out of a share or use up their daily file request limit.
- **server**: Deleted rows are overwritten in the database file, so a later backup or snapshot no longer holds burned notes or hashed IP addresses.
- **server**: Aborting an upload to S3 while it waits for memory no longer weakens the memory limit of the uploads that are still filling a part.
- **server**: The request log cuts the query string of the OIDC callback, which carried the authorization code of every login.
- **docker**: The entrypoint no longer follows a symlink when it sets the owner of the uploads directory.
- **infra**: The report Worker refuses a reply address with characters that would turn the mailto link of the report into a prefilled reply with other recipients, subject or body.
- **infra**: The report Worker bounds the request body, the reasons, the comment and the URL before parsing, and only an exact localhost origin counts as a development origin.

### 📝 Documentation

- **docs**: The API reference lists the 405 answer to HEAD on download routes and the 415 answer to a JSON body without its content type.
