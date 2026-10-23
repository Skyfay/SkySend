#!/usr/bin/env sh
# SkySend CLI installer for Linux and macOS.
# Usage:
#   curl -fsSL https://skysend.app/install.sh | sh
#
# Options (environment variables):
#   INSTALL_DIR   - installation directory (default: /usr/local/bin)
#   VERSION       - specific version to install (default: latest)

set -eu

REPO="skyfay/SkySend"
BINARY_NAME="skysend"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# ── Detect OS and architecture ────────────────────────────────
detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Linux)  OS_NAME="linux" ;;
    Darwin) OS_NAME="macos" ;;
    *)
      echo "Error: Unsupported operating system: $OS"
      exit 1
      ;;
  esac

  case "$ARCH" in
    x86_64|amd64)  ARCH_NAME="x64" ;;
    aarch64|arm64) ARCH_NAME="arm64" ;;
    *)
      echo "Error: Unsupported architecture: $ARCH"
      exit 1
      ;;
  esac

  PLATFORM="${OS_NAME}-${ARCH_NAME}"
}

# ── Resolve version ──────────────────────────────────────────
resolve_version() {
  if [ -n "${VERSION:-}" ]; then
    # Ensure the version starts with v
    case "$VERSION" in
      v*) ;;
      *)  VERSION="v${VERSION}" ;;
    esac
    return
  fi

  echo "Fetching latest version..."
  if command -v curl > /dev/null 2>&1; then
    VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
  elif command -v wget > /dev/null 2>&1; then
    VERSION="$(wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
  else
    echo "Error: curl or wget is required"
    exit 1
  fi

  if [ -z "$VERSION" ]; then
    echo "Error: Could not determine latest version"
    exit 1
  fi
}

# ── Download and install ─────────────────────────────────────
download_and_install() {
  ASSET_NAME="${BINARY_NAME}-${PLATFORM}"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET_NAME}"
  CHECKSUM_URL="https://github.com/${REPO}/releases/download/${VERSION}/checksums.txt"

  echo "Installing SkySend CLI ${VERSION} (${PLATFORM})..."
  echo "  From: ${DOWNLOAD_URL}"

  TMPDIR="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR"' EXIT

  # Download binary
  printf "  Downloading %s...\n" "$ASSET_NAME"
  if command -v curl > /dev/null 2>&1; then
    curl -fL --progress-bar -o "${TMPDIR}/${ASSET_NAME}" "$DOWNLOAD_URL"
    CHECKSUMS_OK=0
    curl -fsSL -o "${TMPDIR}/checksums.txt" "$CHECKSUM_URL" && CHECKSUMS_OK=1
  else
    wget -O "${TMPDIR}/${ASSET_NAME}" "$DOWNLOAD_URL"
    CHECKSUMS_OK=0
    wget -qO "${TMPDIR}/checksums.txt" "$CHECKSUM_URL" && CHECKSUMS_OK=1
  fi

  # Verify the checksum. A binary that cannot be verified is never installed.
  if [ "$CHECKSUMS_OK" != 1 ]; then
    echo "Error: Could not download ${CHECKSUM_URL}. Refusing to install an unverified binary."
    exit 1
  fi

  EXPECTED="$(awk -v name="$ASSET_NAME" '{ f = $2; sub(/^\*/, "", f) } f == name { print $1 }' "${TMPDIR}/checksums.txt")"
  if [ -z "$EXPECTED" ]; then
    echo "Error: checksums.txt lists no checksum for ${ASSET_NAME}. Refusing to install an unverified binary."
    exit 1
  fi

  if command -v sha256sum > /dev/null 2>&1; then
    ACTUAL="$(sha256sum "${TMPDIR}/${ASSET_NAME}" | awk '{print $1}')"
  elif command -v shasum > /dev/null 2>&1; then
    ACTUAL="$(shasum -a 256 "${TMPDIR}/${ASSET_NAME}" | awk '{print $1}')"
  else
    echo "Error: sha256sum or shasum is required to verify the download."
    exit 1
  fi

  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "Error: Checksum mismatch!"
    echo "  Expected: ${EXPECTED}"
    echo "  Actual:   ${ACTUAL}"
    exit 1
  fi
  echo "  Checksum verified."

  # Install
  chmod +x "${TMPDIR}/${ASSET_NAME}"

  if [ -w "$INSTALL_DIR" ]; then
    mv "${TMPDIR}/${ASSET_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
  else
    echo "  Installing to ${INSTALL_DIR} (requires sudo)..."
    sudo mv "${TMPDIR}/${ASSET_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
  fi

  echo ""
  echo "SkySend CLI ${VERSION} installed to ${INSTALL_DIR}/${BINARY_NAME}"
  echo ""
  echo "Get started:"
  echo "  skysend --help"
  echo "  skysend config set-server https://your-instance.example.com"
  echo "  skysend upload ./file.txt"
}

# ── Main ─────────────────────────────────────────────────────
main() {
  detect_platform
  resolve_version
  download_and_install
}

main
