# Troubleshooting

Common issues and how to resolve them.

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
