#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$root/scripts/build.sh"

cmake -E remove_directory "$root/build/test-output"
if [[ -z "${VK_ICD_FILENAMES:-}" &&
      -f /usr/share/vulkan/icd.d/lvp_icd.json ]]; then
    export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
fi
"$root/build/clustered_lighting" \
    --width 480 --height 270 --frames 4 --warmup 2 \
    --out "$root/build/test-output"

python3 - "$root/build/test-output/report.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    report = json.load(stream)
verification = report["verification"]
if not verification["passed"]:
    raise SystemExit("verification failed")
if verification["mismatched_pixels"] != 0:
    raise SystemExit("clustered and brute-force images differ")
print("test passed: 0 mismatched pixels")
PY
