#!/bin/sh
set -e

PUID="${PUID:-1001}"
PGID="${PGID:-1001}"
SKIP_CHOWN="${SKIP_CHOWN:-false}"

# Adjust GID if it differs from the built-in default
if [ "$(id -g skysend)" != "$PGID" ]; then
  delgroup skysend 2>/dev/null || true
  addgroup -g "$PGID" skysend
  adduser skysend skysend 2>/dev/null || true
fi

# Adjust UID if it differs from the built-in default
if [ "$(id -u skysend)" != "$PUID" ]; then
  sed -i "s/^skysend:x:[0-9]*:/skysend:x:${PUID}:/" /etc/passwd
fi

# Ensure ownership of data directories
if [ "$SKIP_CHOWN" = "true" ]; then
  echo "SKIP_CHOWN=true - skipping chown of /data and /uploads"
else
  chown -R skysend:skysend /data
  chown skysend:skysend /uploads 2>/dev/null || true
fi

exec su-exec skysend "$@"
