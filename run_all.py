#!/usr/bin/env python3
"""Run all three SSR scenarios and export comparison images + metrics.

Outputs land in artifacts/results/:
    <scenario>_comparison.png  - raw colour, reflection contribution,
                                 correct fallback vs. missing-fallback
    <scenario>_debug.png       - depth, normals, hit/miss reasons, steps
    ssr_report.json            - hit rates, miss reasons and step cost
"""

from __future__ import annotations

import json
import os

import numpy as np
from PIL import Image

from ssr_demo import imaging
from ssr_demo.imaging import contact_sheet, save_png
from ssr_demo.pipeline import FrameResult, render_frame, wrong_pixel_count
from ssr_demo.scenarios import SCENARIO_NAMES, build_scenario, fast_camera_views

WIDTH, HEIGHT = 480, 360
OUT_DIR = os.path.join(os.path.dirname(__file__), "artifacts", "results")


def _comparison_panels(frame: FrameResult) -> list[tuple[str, np.ndarray]]:
    return [
        ("1 raw direct colour (no SSR)", frame.direct),
        ("2 reflection contribution", frame.reflection_only),
        ("3 correct: ambient fallback on miss", frame.correct_composite),
        ("4 MISSING fallback: wrong sampled pixels", frame.naive_composite),
    ]


def _save_scenario(name: str, frame: FrameResult) -> dict:
    panels = _comparison_panels(frame)
    sheet = contact_sheet(panels, columns=2)
    Image.fromarray(sheet).save(os.path.join(OUT_DIR, f"{name}_comparison.png"))

    debug_panels = imaging.debug_visualization(frame.gbuffer, frame.result, frame)
    debug_sheet = contact_sheet(debug_panels, columns=2)
    Image.fromarray(debug_sheet).save(os.path.join(OUT_DIR, f"{name}_debug.png"))

    save_png(frame.correct_composite, os.path.join(OUT_DIR, f"{name}_final.png"))
    metrics = dict(frame.metrics)
    metrics["wrong_pixel_policy"] = wrong_pixel_count(frame)
    return metrics


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    report: dict = {"resolution": [WIDTH, HEIGHT], "scenarios": {}}

    for name in SCENARIO_NAMES:
        objects, camera = build_scenario(name)
        if name == "fast_camera":
            frames = []
            for view in fast_camera_views():
                frames.append(render_frame(objects, view, WIDTH, HEIGHT))
            # Keep the middle frame for the stills, aggregate metrics across
            # the whole fast-move sweep.
            frame = frames[1]
            per_view = []
            for index, view_frame in enumerate(frames):
                per_view.append({
                    "view": index,
                    **view_frame.metrics,
                    "wrong_pixel_policy": wrong_pixel_count(view_frame),
                })
            report["scenarios"][name] = {
                "sweep_views": per_view,
                "representative_view": _save_scenario(name, frame),
            }
        else:
            frame = render_frame(objects, camera, WIDTH, HEIGHT)
            report["scenarios"][name] = _save_scenario(name, frame)
        print(f"[done] {name}: {frame.metrics}")

    with open(os.path.join(OUT_DIR, "ssr_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"report -> {os.path.join(OUT_DIR, 'ssr_report.json')}")


if __name__ == "__main__":
    main()
