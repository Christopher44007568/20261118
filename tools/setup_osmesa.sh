#!/usr/bin/env bash
# Bootstrap a local OSMesa + GL development prefix WITHOUT root.
# Downloads .deb packages via apt (no installation) and extracts them into
# $LOCAL_PREFIX. Needed because the sandbox has the Mesa runtime but no GL
# development headers or libOSMesa, and sudo requires a password.
set -euo pipefail

LOCAL_PREFIX="${LOCAL_PREFIX:-/tmp/local}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cd "$STAGE"

apt-get download libosmesa6 libosmesa6-dev mesa-common-dev \
                 libgl-dev libglx-dev libglvnd-dev libllvm20

mkdir -p "$LOCAL_PREFIX"
for deb in *.deb; do
    dpkg-deb -x "$deb" "$LOCAL_PREFIX"
done

echo "OSMesa/GL prefix ready at: $LOCAL_PREFIX/usr"
echo "Build with: LOCAL_PREFIX=$LOCAL_PREFIX/usr ./build.sh"
