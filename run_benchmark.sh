#!/usr/bin/env bash
# Reproducible headless benchmark + validation sweep.
# Requires the locally extracted OSMesa prefix (build.sh uses the same one).
set -euo pipefail
cd "$(dirname "$0")"

export LOCAL_PREFIX="${LOCAL_PREFIX:-/tmp/local/usr}"
export LD_LIBRARY_PATH="$LOCAL_PREFIX/lib/x86_64-linux-gnu"
export SHADER_DIR=shaders
FRAMES="${FRAMES:-48}"

./build.sh >/dev/null
mkdir -p results screenshots

echo "### Grass, density scaling sweep ($FRAMES frames each)"
echo "mode,density,frames,avg_ms,p95_ms,min_ms,max_ms,draw_calls_per_frame,instances_per_frame,pop_events" \
    > results/sweep.csv

for dens in 64 128 256 512; do
    echo "--- density $dens ---"
    ./build/grass_renderer --frames "$FRAMES" --density "$dens" \
        | tee "results/grass_d${dens}.log"
    # Append the three data rows (skip header) to the sweep CSV.
    tail -n +2 results/benchmark.csv >> results/sweep.csv
done

echo
echo "### Bush variant (lower density, larger meshes)"
./build/grass_renderer --frames "$FRAMES" --bushes --density 40 \
    | tee results/bush.log
cp results/benchmark.csv results/bush_benchmark.csv

echo
echo "### Fade disabled control (demonstrates hard chunk pops)"
./build/grass_renderer --frames "$FRAMES" --no-fade \
    | tee results/no_fade_control.log

echo
echo "### Wind motion + root-pin demo"
./build/grass_renderer --frames 8 --wind-demo | tee results/wind_demo.log

echo
echo "### Chunk fade-in transition demo"
./build/fade_demo | tee results/fade_demo.log

echo
echo "Converting screenshots to PNG..."
for p in screenshots/*.ppm; do
    [ -e "$p" ] || continue
    python3 tools/ppm_to_png.py "$p" "${p%.ppm}.png" >/dev/null
done

echo
echo "Done. Logs in results/, images in screenshots/."
