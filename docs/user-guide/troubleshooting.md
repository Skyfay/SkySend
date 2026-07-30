# Troubleshooting

Common issues and how to resolve them.

## Upload fails with "Origin not allowed"

**Symptom:** A file upload or WebSocket connection attempt fails immediately with the message "Origin not allowed".

**Cause:** The SkySend server automatically allows the origin that matches `BASE_URL`. If the frontend is accessed from a different URL - for example a different port, hostname, or protocol - the server rejects the WebSocket connection because that origin is not in the allowed list.

This typically happens in development or when `BASE_URL` is set to a different address than the one the browser is using to access the app.

**Fix:** Make sure `BASE_URL` matches the URL you are using in the browser exactly, including the protocol and port:

```env
BASE_URL=https://send.example.com
```

If you need to allow additional origins on top of `BASE_URL` (for example when the frontend is served from a CDN at a different domain), add them as a comma-separated list in `CORS_ORIGINS`:

```env
CORS_ORIGINS=https://cdn.example.com,https://www.example.com
```

See the [Environment Variables reference](/user-guide/configuration/environment-variables) for details.

## `crypto.subtle is undefined` / `Cannot read properties of undefined (reading 'importKey')`

**Symptom:** Uploading a file or creating a note fails with one of these errors in the browser console:

- Firefox: `can't access property "importKey", crypto.subtle is undefined`
- Chrome / Edge: `Cannot read properties of undefined (reading 'importKey')`

**Cause:** SkySend uses the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) (`crypto.subtle`) to perform client-side encryption. Browsers only expose this API in [secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) - meaning the page must be served over **HTTPS** or from **`localhost`**. Plain HTTP URLs (e.g. `http://192.168.1.10:3000` or `http://server:3000`) are not considered secure and the API is unavailable.

**Fix:** Place SkySend behind a reverse proxy that terminates TLS. See the [Reverse Proxy guide](/user-guide/self-hosting/reverse-proxy) for setup examples with Caddy, Nginx, and Traefik.

::: tip Local testing
If you are only testing locally on the same machine, `http://localhost:3000` works without HTTPS because `localhost` is treated as a secure context by browsers.
:::

## Upload silently fails or hangs with Nginx

**Symptom:** File uploads stall, disconnect mid-way, or the progress bar freezes.

**Cause:** Nginx's default request buffering interferes with SkySend's streaming upload transport. Missing or incorrect WebSocket headers also break the WebSocket upload mode.

**Fix:** Make sure your Nginx config includes all required directives. See the [Reverse Proxy guide](/user-guide/self-hosting/reverse-proxy#nginx) for the full reference config, in particular:

- `proxy_request_buffering off` - required for streaming uploads
- `proxy_buffering off` - required for streaming downloads
- `Upgrade` / `Connection` headers and the `$connection_upgrade` map - required for WebSocket uploads
- `proxy_read_timeout` / `proxy_send_timeout` - must exceed the longest expected upload duration
- `client_max_body_size` - must be at least as large as your `FILE_MAX_SIZE` setting

## S3 downloads fail with CORS error

**Symptom:** A download stalls immediately after clicking the download button and shows the error: "S3 CORS error: The bucket must allow cross-origin GET requests from this origin."

**Cause:** SkySend uses presigned URLs for S3/R2 downloads so the file stream goes directly from the bucket to the browser without passing through SkySend. The browser enforces CORS for these cross-origin requests, so the bucket must explicitly allow GET requests from SkySend's origin.

**Fix:** Open your bucket's CORS settings and add a rule that allows GET and HEAD requests from your SkySend origin:

```json
[
  {
    "AllowedOrigins": ["https://send.example.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

For Cloudflare R2, set the allowed origin in the R2 bucket settings under **CORS policy**.

::: warning No trailing slash
The origin value must not end with a slash. `https://send.example.com` is correct. `https://send.example.com/` will not match and CORS will still fail.
:::

## Share link opens but the page says "not found"

**Symptom:** A share link that works when opened directly shows "not found" after being sent by email. The address bar contains `%23` where the link should have a `#`:

```
https://send.example.com/file/c9c9c3a2-...-8b001a8051c7%23Xy1wbZmb0OePQ...
```

**Cause:** A mail security gateway rewrote the link. Microsoft Defender for Office 365 Safe Links wraps the original URL in a query parameter, and the `#` survives that round trip only as its percent-encoded form `%23`. Browsers never decode `%23` in a path, so the key ends up as part of the path instead of the URL fragment, and the page cannot read it.

Proofpoint URL Defense, Mimecast, and similar products rewrite links the same way. Some of them drop the fragment entirely.

**Fix:** Nothing to configure. SkySend detects this exact shape and moves the key back into the fragment before the page loads, so the link works on the second hop. A warning is shown because the rewrite has a real consequence: the key travelled to the server inside the request path, which a normal share link never does.

::: warning The key was exposed
A rewritten link is no longer a zero-knowledge link. The server, the reverse proxy, and any CDN in front of them saw the key in the request path. SkySend truncates its own request log at the resource ID, but logs outside the application are the operator's responsibility.

Asking for a new link does not help, because the old key is already out. What helps is removing what that key unlocks: **download or view the content, then ask the sender to delete the upload.** Once the ciphertext is gone, a key sitting in a log line is worthless. A one-time download link that has already been used is deleted for you.

This is not airtight. On an upload **without a password**, an operator who keeps the access log alongside backups of the database and the blob storage holds everything needed to decrypt it, deletion included. On an upload **with a password**, they do not: the password never reaches the server, and without it the leaked secret decrypts nothing.

So treat a rewritten link as compromised. Re-share genuinely sensitive content through a different channel, with a password sent separately. See the [Threat Model](/user-guide/security/threat-model#link-rewriting-by-mail-security-gateways) for the full breakdown.
:::

If the gateway strips the fragment instead of encoding it, nothing can recover the key, because it never reaches the browser. Share the link through a different channel in that case.
