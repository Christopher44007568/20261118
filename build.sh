#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PREFIX="${HOME}/local/prefix/usr"
GLSLANG="${GLSLANG:-$PREFIX/bin/glslangValidator}"
CC="${CC:-gcc}"

mkdir -p build/spv
for s in base volume composite; do
    "$GLSLANG" -V --target-env vulkan1.2 -e main -Ishaders \
        shaders/${s}.comp -o build/spv/${s}.comp.spv
done
"$GLSLANG" -V --target-env vulkan1.2 shaders/smoke.comp -o build/smoke.comp.spv
"$GLSLANG" -V --target-env vulkan1.2 shaders/imgtest.comp -o build/spv/imgtest.comp.spv

CFLAGS="-O2 -std=c11 -Wall -Wextra -Wno-missing-field-initializers -Wno-nonnull -Wno-format-truncation -I$PREFIX/include"
LDFLAGS="-L$PREFIX/lib/x86_64-linux-gnu -lvulkan -lm -Wl,-rpath,$PREFIX/lib/x86_64-linux-gnu"
$CC $CFLAGS src/vk_engine.c src/main.c -o build/volspot $LDFLAGS
$CC $CFLAGS src/smoke.c -o build/smoke $LDFLAGS
$CC $CFLAGS src/vk_engine.c src/imgtest.c -o build/imgtest $LDFLAGS
$CC $CFLAGS src/vk_engine.c src/compare.c -o build/compare $LDFLAGS
$CC $CFLAGS src/analyze_frames.c -o build/analyze_frames -lm
$CC $CFLAGS src/analyze_trunc.c -o build/analyze_trunc -lm
echo "build ok -> build/volspot"
