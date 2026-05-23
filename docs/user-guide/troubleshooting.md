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
