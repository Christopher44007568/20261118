#!/usr/bin/env bash
# Runs the GPU frustum-culling demo. On machines with a physical GPU the
# default loader picks it automatically; set VK_ICD_FILENAMES to force an
# ICD (this container has no /dev/dri, so we default to lavapipe).
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -x ./gpu_frustum_culling ]]; then
    make
fi

export VK_ICD_FILENAMES="${VK_ICD_FILENAMES:-/usr/share/vulkan/icd.d/lvp_icd.json}"

# Optional Khronos validation layer when it has been unpacked under ~/local.
LAYER_DIR="$HOME/local/usr/share/vulkan/explicit_layer.d"
if [[ -f "$LAYER_DIR/VkLayer_khronos_validation.json" ]]; then
    export VK_ADD_LAYER_PATH="$LAYER_DIR"
    export LD_LIBRARY_PATH="$HOME/local/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
    if [[ "${ENABLE_VALIDATION:-0}" == "1" ]]; then
        export VK_INSTANCE_LAYERS=VK_LAYER_KHRONOS_validation
    fi
fi

./gpu_frustum_culling
