#!/usr/bin/env bash
# Builds the headless instanced grass/bush renderer against a locally extracted
# OSMesa + GL header prefix (no root installation required).
set -euo pipefail
cd "$(dirname "$0")"

LOCAL_PREFIX="${LOCAL_PREFIX:-/tmp/local/usr}"
mkdir -p build

CXX="${CXX:-g++}"
SRCS=(src/math_util.cpp src/gl_loader.cpp src/osmesa_app.cpp src/terrain.cpp
      src/grass_field.cpp src/geometry.cpp src/renderer.cpp src/main.cpp)

$CXX -std=c++17 -O2 -Wall -Wextra \
    -I"$LOCAL_PREFIX/include" \
    "${SRCS[@]}" \
    -L"$LOCAL_PREFIX/lib/x86_64-linux-gnu" \
    -lOSMesa \
    -Wl,-rpath,"$LOCAL_PREFIX/lib/x86_64-linux-gnu" \
    -o build/grass_renderer

# Fade-transition helper reuses every source except the benchmark main.
DEMO_SRCS=()
for s in "${SRCS[@]}"; do
    [ "$s" != "src/main.cpp" ] && DEMO_SRCS+=("$s")
done
DEMO_SRCS+=("src/fade_demo.cpp")
$CXX -std=c++17 -O2 -Wall -Wextra \
    -I"$LOCAL_PREFIX/include" \
    "${DEMO_SRCS[@]}" \
    -L"$LOCAL_PREFIX/lib/x86_64-linux-gnu" \
    -lOSMesa \
    -Wl,-rpath,"$LOCAL_PREFIX/lib/x86_64-linux-gnu" \
    -o build/fade_demo

echo "built build/grass_renderer"
echo "built build/fade_demo"
