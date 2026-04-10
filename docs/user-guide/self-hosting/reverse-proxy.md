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
    }
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
