# Docker Setup

For basic installation see [Installation](/user-guide/installation). This page covers advanced Docker configuration topics.

## Custom Port

The `PORT` environment variable changes the port the server listens on **inside the container**. You also need to update the port mapping to expose it on the host.

The simplest approach is to keep the internal port at `3000` and only change the host-side mapping:

```yaml
ports:
  - "8080:3000"  # host:container
```

If you also want to change the internal port, set `PORT` and match both sides:

```yaml
ports:
  - "8080:8080"
environment:
  - PORT=8080
```

Or via the command line:

```bash
PORT=8080 docker compose up -d
```

## Updating

Before updating, it is recommended to back up your data directory - see [Data & Backups](/user-guide/self-hosting/data-backups). Check the [Changelog](/changelog) for release notes and any breaking changes before pulling a new version.

```bash
docker compose pull
docker compose up -d
```

Your data is preserved in the mounted volumes.
