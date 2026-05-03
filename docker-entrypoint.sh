#!/bin/sh
set -e

PUID="${PUID:-1001}"
PGID="${PGID:-1001}"
SKIP_CHOWN="${SKIP_CHOWN:-false}"
DATA_DIR="${DATA_DIR:-/data}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"

# Adjust GID if it differs from the built-in default
if [ "$(id -g skysend)" != "$PGID" ]; then
  sed -i "s/^skysend:x:[0-9]*/skysend:x:${PGID}/" /etc/group
  sed -i "s/^\(skysend:x:[0-9]*:\)[0-9]*/\1${PGID}/" /etc/passwd
fi

# Adjust UID if it differs from the built-in default
if [ "$(id -u skysend)" != "$PUID" ]; then
  sed -i "s/^skysend:x:[0-9]*:/skysend:x:${PUID}:/" /etc/passwd
fi

# Ensure ownership of data directories
if [ "$SKIP_CHOWN" = "true" ]; then
  echo "SKIP_CHOWN=true - skipping chown of ${DATA_DIR} and ${UPLOADS_DIR}"
else
  mkdir -p "${DATA_DIR}"
  chown -R skysend:skysend "${DATA_DIR}"
  mkdir -p "${UPLOADS_DIR}"
  chown skysend:skysend "${UPLOADS_DIR}" 2>/dev/null || true
fi

exec su-exec skysend "$@"
