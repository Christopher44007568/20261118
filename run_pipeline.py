"""Run the Bloom pipeline over the three test scenes and export artifacts.

Outputs (under artifacts/):
  previews/<scene>_pyramid.png   - every mip level as a contact sheet
  previews/<scene>_layers.png    - per-level full-resolution contributions
  comparisons/<scene>_compare.png - Bloom OFF vs ON side by side
  comparisons/<scene>_bloom.png   - isolated bloom texture
  report.json                     - peak / mean / whiteness measurements
"""

from __future__ import annotations

import json
import os

import numpy as np

from bloom import BloomConfig, apply_bloom
from bloom.imaging import comparison_sheet, preview_sheet, save_png
from bloom.metrics import halo_decay_profile, summarize
from bloom.scenes import SCENES


ARTIFACT_ROOT = os.path.join(os.path.dirname(__file__), "artifacts")


def _ensure_dirs() -> tuple[str, str]:
    previews = os.path.join(ARTIFACT_ROOT, "previews")
    comparisons = os.path.join(ARTIFACT_ROOT, "comparisons")
    os.makedirs(previews, exist_ok=True)
    os.makedirs(comparisons, exist_ok=True)
    return previews, comparisons


def run_scene(name: str, config: BloomConfig) -> dict:
    previews_dir, comparisons_dir = _ensure_dirs()
    scene = SCENES[name]()
    result = apply_bloom(scene, config)

    pyramid = result["pyramid"]
    pyramid_labels = [
        f"root {pyramid[0].shape[1]}x{pyramid[0].shape[0]}"
    ] + [
        f"mip{i} {tex.shape[1]}x{tex.shape[0]}" for i, tex in enumerate(pyramid[1:], 1)
    ]
    preview_sheet(
        pyramid,
        pyramid_labels,
        os.path.join(previews_dir, f"{name}_pyramid.png"),
    )

    contributions = result["contributions"]
    layer_labels = [f"layer{i} weight{w:.2f}" for i, w in enumerate(config.normalized_weights(), 1)]
    preview_sheet(
        contributions,
        layer_labels,
        os.path.join(previews_dir, f"{name}_layers.png"),
        tile=160,
    )

    save_png(result["bloom"], os.path.join(comparisons_dir, f"{name}_bloom.png"))
    comparison_sheet(
        result["source"],
        result["composite"],
        os.path.join(comparisons_dir, f"{name}_compare.png"),
    )

    stats = summarize(result["source"], result["composite"], result["bloom"])
    centers = {
        "sun": (0.32, 0.62),
        "bulbs": (0.30, 0.22),
        "dark_bg": (0.40, 0.30),
    }
    fy, fx = centers[name]
    center = (scene.shape[0] * fy, scene.shape[1] * fx)
    stats["halo_decay"] = halo_decay_profile(result["bloom"], center, 64)
    stats["levels_built"] = len(pyramid)
    return stats


def main() -> None:
    config = BloomConfig(
        threshold=1.0,
        soft_knee=0.6,
        radius=1.2,
        level_weights=(0.34, 0.27, 0.19, 0.12, 0.08),
        intensity=0.9,
        levels=5,
    )
    report: dict = {"config": config.__dict__, "scenes": {}}
    for name in SCENES:
        report["scenes"][name] = run_scene(name, config)

    with open(os.path.join(ARTIFACT_ROOT, "report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
