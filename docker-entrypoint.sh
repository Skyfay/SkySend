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
  # -h never follows a symlink. With UPLOADS_DIR inside DATA_DIR, which the runtime user owns
  # after the line above, that user could put a link to /usr/local/bin in its place, and a
  # chown that follows it would hand root's files to the runtime user on the next start.
  if [ -L "${UPLOADS_DIR}" ]; then
    echo "UPLOADS_DIR ${UPLOADS_DIR} is a symlink - leaving the owner of its target as it is"
  fi
  chown -h skysend:skysend "${UPLOADS_DIR}" 2>/dev/null || true
fi

exec su-exec skysend "$@"
