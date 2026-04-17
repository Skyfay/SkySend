# Reverse Proxy

SkySend should be placed behind a reverse proxy for production use. This provides TLS termination, custom domain support, and additional security.

::: warning Required for Production
SkySend share links contain the encryption key in the URL fragment (`#`). Using HTTPS is essential to prevent the link from being intercepted in transit.
:::

## Caddy (Recommended)

Caddy automatically provisions and renews TLS certificates:

```
skysend.example.com {
    reverse_proxy localhost:3000
}
```

That's it. Caddy handles HTTPS automatically.

## Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name skysend.example.com;

    ssl_certificate     /etc/letsencrypt/live/skysend.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/skysend.example.com/privkey.pem;

    client_max_body_size 2G;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for streaming uploads
        proxy_request_buffering off;

        # Required for streaming downloads
        proxy_buffering off;

        # Required for the WebSocket upload transport (FILE_UPLOAD_WS)
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Keep long-running WebSocket uploads from timing out.
        # Adjust to the largest expected upload duration.
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
    }
}

# Map required to select the correct Connection header for WebSocket upgrade.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name skysend.example.com;
    return 301 https://$server_name$request_uri;
}
```

::: tip Important Nginx Settings
- `client_max_body_size` must match your `MAX_FILE_SIZE` setting
- `proxy_request_buffering off` is required for streaming uploads
- `proxy_buffering off` is required for streaming downloads
- The `Upgrade` / `Connection` headers and the `$connection_upgrade` map are required for the WebSocket upload transport (`FILE_UPLOAD_WS`, default on)
- `proxy_read_timeout` / `proxy_send_timeout` must be larger than the longest expected upload or Nginx will close the WebSocket mid-upload
:::

## Traefik

Using Docker labels with Traefik:

```yaml
services:
  skysend:
    build: .
    restart: always
    volumes:
      - "${DATA_DIR:-./data}:/app/data"
    env_file:
      - .env
    environment:
      - DATA_DIR=/app/data
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.skysend.rule=Host(`skysend.example.com`)"
      - "traefik.http.routers.skysend.entrypoints=websecure"
      - "traefik.http.routers.skysend.tls.certresolver=letsencrypt"
      - "traefik.http.services.skysend.loadbalancer.server.port=3000"
```

::: tip Traefik and the WebSocket upload transport
Traefik forwards WebSocket upgrade requests automatically, so no extra labels are required to use the WebSocket upload transport (`FILE_UPLOAD_WS`, enabled by default). However the upload must finish within the Traefik idle timeouts. For long uploads on slow connections, raise the entrypoint read/write timeouts in your static configuration:

```yaml
entryPoints:
  websecure:
    address: ":443"
    transport:
      respondingTimeouts:
        readTimeout: 3600s
        writeTimeout: 3600s
        idleTimeout: 3600s
```

If the upgrade fails (for example because a middleware strips the `Upgrade` header), clients automatically fall back to the HTTP chunked upload.
:::

## Trust Proxy

When running behind a reverse proxy, set `TRUST_PROXY=true` so that SkySend correctly reads the client IP from `X-Forwarded-For` and `X-Real-IP` headers. This is important for rate limiting and upload quotas.

```bash
TRUST_PROXY=true
```

::: danger Security Warning
Only enable `TRUST_PROXY` when SkySend is behind a trusted reverse proxy. If exposed directly to the internet with this setting enabled, clients can spoof their IP address.
:::

## BASE_URL

Set the `BASE_URL` to your public domain so that generated upload URLs are correct:

```bash
BASE_URL=https://skysend.example.com
```
