"""Generate film-grain samples and validation metrics.

Outputs (under output/):
  static/off|light|heavy/*.png     static frame sequences
  dynamic/off|light|heavy/*.png    moving-shot frame sequences
  dynamic/off|light|heavy.mp4      H.264 encodes of the moving shot
  contact_sheet_static.png         side-by-side comparison
  contact_sheet_dynamic.png
  metrics.json / metrics_report.txt numeric validation
"""

from __future__ import annotations

import json
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
from PIL import Image

from grain_pipeline.grain import GrainParams, apply_grain
from grain_pipeline.metrics import (
    black_lift,
    edge_repetition,
    regional_std,
    std_report,
    temporal_stability,
)
from grain_pipeline.scene import BLACK_BORDER, dynamic_scene, static_scene
from grain_pipeline.tonemap import to_uint8, tone_map

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "output"

WIDTH, HEIGHT = 480, 270
STATIC_FRAMES = 6
DYNAMIC_FRAMES = 24
FPS = 12

MODES = {
    "off": GrainParams(strength=0.0),
    "light": GrainParams(strength=0.06, scale=1.6),
    "heavy": GrainParams(strength=0.18, scale=2.6),
}


def _render_shot(kind: str, frame: int, total: int):
    if kind == "static":
        hdr = static_scene(HEIGHT, WIDTH, frame)
    else:
        hdr = dynamic_scene(HEIGHT, WIDTH, frame, total)
    return tone_map(hdr)


def run() -> dict:
    OUT.mkdir(exist_ok=True)
    metrics: dict = {}

    for kind, total in (("static", STATIC_FRAMES),
                        ("dynamic", DYNAMIC_FRAMES)):
        metrics[kind] = {}
        stored = {m: {"clean": [], "grained": []} for m in MODES}

        for mode, params in MODES.items():
            mode_dir = OUT / kind / mode
            mode_dir.mkdir(parents=True, exist_ok=True)

            for frame in range(total):
                clean = _render_shot(kind, frame, total)
                grained, _delta = apply_grain(clean, frame, params)
                stored[mode]["clean"].append(clean)
                stored[mode]["grained"].append(grained)

                Image.fromarray(to_uint8(grained)).save(
                    mode_dir / f"frame_{frame:03d}.png"
                )

            _encode_mp4(kind, mode, mode_dir, total)
            metrics[kind][mode] = _measure(
                stored[mode]["clean"], stored[mode]["grained"]
            )

        _contact_sheet(kind, stored)

    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (OUT / "metrics_report.txt").write_text(_format_report(metrics))
    return metrics


def _encode_mp4(kind: str, mode: str, mode_dir: Path, total: int) -> None:
    if kind != "dynamic":
        return
    clip_path = OUT / "dynamic" / f"{mode}.mp4"
    with imageio.get_writer(
        clip_path, fps=FPS, codec="libx264",
        quality=8, macro_block_size=None,
    ) as writer:
        for frame in range(total):
            writer.append_data(imageio.imread(
                mode_dir / f"frame_{frame:03d}.png"
            ))


def _measure(clean_frames: list[np.ndarray],
             grained_frames: list[np.ndarray]) -> dict:
    mid = len(clean_frames) // 2
    rep = std_report(clean_frames[mid], grained_frames[mid])
    rep.update(regional_std(clean_frames[mid], grained_frames[mid]))
    rep.update(black_lift(clean_frames[mid], grained_frames[mid]))
    rep.update(edge_repetition(grained_frames[mid], clean_frames[mid]))
    rep.update(temporal_stability(grained_frames, clean_frames))
    return rep


def _contact_sheet(kind: str, stored: dict) -> None:
    """Three panels (off / light / heavy) of the same frame, labelled."""
    frame_idx = 2 if kind == "static" else DYNAMIC_FRAMES // 2
    panels = []
    for mode in MODES:
        img = to_uint8(stored[mode]["grained"][frame_idx])
        canvas = np.full((img.shape[0] + 24, img.shape[1], 3),
                         32, dtype=np.uint8)
        canvas[24:, :, :] = img
        label = f"{kind} - {mode}"
        panels.append((label, canvas))

    gap = 8
    h = panels[0][1].shape[0]
    w = panels[0][1].shape[1]
    sheet = np.full((h, w * 3 + gap * 2, 3), 18, dtype=np.uint8)
    for i, (_label, panel) in enumerate(panels):
        x0 = i * (w + gap)
        sheet[:, x0:x0 + w] = panel
    Image.fromarray(sheet).save(OUT / f"contact_sheet_{kind}.png")


def _fmt_row(mode: str, r: dict) -> str:
    return (
        f"  {mode:<5} | std clean={r['std_clean']:.4f} "
        f"grained={r['std_grained']:.4f} delta={r['std_delta']:.4f} | "
        f"shadow={r['shadow_std_delta']:.4f} "
        f"highlight={r['highlight_std_delta']:.4f} | "
        f"blackLiftPx={r['black_lifted_pixels']} "
        f"blackMax={r['black_max_after']:.4f} | "
        f"edgeTB={r['edge_corr_top_bottom']:+.3f} "
        f"edgeLR={r['edge_corr_left_right']:+.3f} | "
        f"tempCorr={r['temporal_corr_mean']:+.3f}"
    )


def _format_report(metrics: dict) -> str:
    lines = [
        "Film grain validation report",
        "=" * 60,
        "std: luminance standard deviation; delta: grain-only contribution",
        "shadow/highlight: std of grain in dark (luma<0.30) / bright (>0.75)",
        "blackLiftPx: pure-black pixels that became non-zero (must be 0)",
        "edge*: opposite-edge grain correlation (~0 means no tiling repeat)",
        "tempCorr: frame-to-frame grain correlation (white noise -> ~0)",
        "",
    ]
    for kind, modes in metrics.items():
        lines.append(f"[{kind} shot]")
        for mode, rep in modes.items():
            lines.append(_fmt_row(mode, rep))
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    report = run()
    print((OUT / "metrics_report.txt").read_text())
    print(f"black border width per side: {BLACK_BORDER} px")
