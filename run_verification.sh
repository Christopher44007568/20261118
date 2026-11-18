#!/usr/bin/env bash
# End-to-end verification for the volumetric spot-light pipeline.
# Runs entirely headless on lavapipe (software Vulkan).
set -euo pipefail
cd "$(dirname "$0")"

export VK_ICD_FILENAMES="${VK_ICD_FILENAMES:-/usr/share/vulkan/icd.d/lvp_icd.json}"
BIN=./build/volspot
CMP=./build/compare
OUT=results/verify
PIXELS=$((960 * 540))
mkdir -p "$OUT"

run() { echo "+ $BIN $*"; "$BIN" "$@"; }

echo "================ 1. build & device ================"
./build.sh >/dev/null 2>&1
echo "device: $(VK_ICD_FILENAMES=$VK_ICD_FILENAMES ./build/smoke build/smoke.comp.spv | head -1)"

echo "================ 2. camera presets (with volume) ================"
for c in a b c d; do
  run --cam "$c" --no-jitter --out "$OUT/cam-$c.png"
done

echo "================ 3. volume off vs on ================"
run --cam a --no-volume --no-jitter --dump-f32 --out "$OUT/vol-off.png"
run --cam a --no-jitter --dump-f32 --out "$OUT/vol-on.png"
"$CMP" "$OUT/vol-off.png.f32.bin" "$OUT/vol-on.png.f32.bin" "$PIXELS" "off-vs-on "

echo "================ 4. rock truncation ================"
run --cam a --no-jitter --stats --dump-f32 --out "$OUT/trunc.png"
./build/analyze_trunc "$OUT/trunc.png.f32.bin" 960 540

echo "================ 5. camera fly-through (no sudden flip) ================"
run --frames 24 --no-jitter --dump-f32 --out "$OUT/fly"
./build/analyze_frames "$OUT/fly" 24 "$PIXELS" | tail -6

echo "================ 6. near-plane banding check ================"
# Sweep the camera toward the near plane; frozen jitter makes any stripe band
# deterministic. Smoothly increasing luminance means no banding or pop.
for z in 3.0 1.5 0.5 0.2; do
  run --cam c --cam-z "$z" --no-jitter --dump-f32 --out "$OUT/near-$z.png"
done
./build/analyze_frames "$OUT/near" 1 "$PIXELS" >/dev/null 2>&1 || true
./build/compare "$OUT/near-3.0.png.f32.bin" "$OUT/near-0.2.png.f32.bin" "$PIXELS" "near-far-vs-close "

echo "================ 7. control parameters ================"
run --cam a --scatter 0.0 --no-jitter --dump-f32 --out "$OUT/scatter0.png"
run --cam a --scatter 2.5 --no-jitter --dump-f32 --out "$OUT/scatter25.png"
run --cam a --steps 16  --no-jitter --out "$OUT/steps16.png"
run --cam a --steps 96  --no-jitter --out "$OUT/steps96.png"
run --cam a --seed 11.0 --no-jitter --out "$OUT/seed11.png"
run --cam a --seed 77.0 --no-jitter --out "$OUT/seed77.png"
"$CMP" "$OUT/vol-off.png.f32.bin" "$OUT/scatter0.png.f32.bin" "$PIXELS" "scatter0==off "
"$CMP" "$OUT/scatter0.png.f32.bin" "$OUT/scatter25.png.f32.bin" "$PIXELS" "scatter25-vs-0 "

echo "================ 8. full vs half resolution: error + timing ================"
run --cam a --full-res --no-jitter --dump-f32 --out "$OUT/full.png"
run --cam a --no-jitter --dump-f32 --out "$OUT/half.png"
"$CMP" "$OUT/full.png.f32.bin" "$OUT/half.png.f32.bin" "$PIXELS" "half-vs-full "

echo "verification artifacts written to $OUT"
