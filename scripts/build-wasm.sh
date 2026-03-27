#!/usr/bin/env bash
set -euo pipefail

# Build the DOOM WASM engine from cloudflare/doom-wasm
# Requires: Emscripten SDK (emsdk), automake, autoconf
#
# Usage: ./scripts/build-wasm.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.build"
DOOM_WASM_DIR="$BUILD_DIR/doom-wasm"
PUBLIC_DIR="$PROJECT_DIR/public"

echo "==> Checking Emscripten..."
if ! command -v emcc &>/dev/null; then
  echo "ERROR: Emscripten not found."
  echo ""
  echo "Install it:"
  echo "  git clone https://github.com/emscripten-core/emsdk.git"
  echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
  echo "  source ./emsdk_env.sh"
  exit 1
fi

echo "==> Cloning cloudflare/doom-wasm..."
mkdir -p "$BUILD_DIR"
if [ ! -d "$DOOM_WASM_DIR" ]; then
  git clone --depth 1 https://github.com/cloudflare/doom-wasm.git "$DOOM_WASM_DIR"
else
  echo "    (using existing clone)"
fi

echo "==> Building DOOM WASM..."
cd "$DOOM_WASM_DIR"
./scripts/build.sh

echo "==> Copying artifacts to public/..."
cp src/websockets-doom.js "$PUBLIC_DIR/"
cp src/websockets-doom.wasm "$PUBLIC_DIR/"

echo ""
echo "==> Done! WASM artifacts are in public/"
echo "    websockets-doom.js"
echo "    websockets-doom.wasm"
echo ""
echo "You still need doom1.wad — download shareware DOOM:"
echo "  curl -L -o public/doom1.wad https://distro.ibiblio.org/slitaz/sources/packages/d/doom1.wad"
