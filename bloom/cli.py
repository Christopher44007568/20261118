"""Command line entry point for tuning Bloom parameters on a scene.

Example
-------
python -m bloom.cli --scene sun --threshold 1.2 --soft-knee 0.4 \
    --radius 1.5 --weights 0.4 0.3 0.18 0.08 0.04 --intensity 1.1
"""

from __future__ import annotations

import argparse
import json
import os

from .pipeline import BloomConfig, apply_bloom
from .imaging import comparison_sheet, save_png
from .metrics import summarize
from .scenes import SCENES


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Tunable HDR Bloom pipeline")
    parser.add_argument("--scene", choices=sorted(SCENES), default="sun")
    parser.add_argument("--threshold", type=float, default=1.0)
    parser.add_argument("--soft-knee", type=float, default=0.6)
    parser.add_argument("--radius", type=float, default=1.2)
    parser.add_argument("--intensity", type=float, default=0.9)
    parser.add_argument("--levels", type=int, default=5)
    parser.add_argument(
        "--weights", type=float, nargs="+",
        default=(0.34, 0.27, 0.19, 0.12, 0.08),
        help="Per-level additive weights, tightest mip first.",
    )
    parser.add_argument("--out-dir", default="artifacts/cli")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    config = BloomConfig(
        threshold=args.threshold,
        soft_knee=args.soft_knee,
        radius=args.radius,
        level_weights=tuple(args.weights),
        intensity=args.intensity,
        levels=args.levels,
    )
    scene = SCENES[args.scene]()
    result = apply_bloom(scene, config)
    os.makedirs(args.out_dir, exist_ok=True)
    comparison_sheet(
        result["source"],
        result["composite"],
        os.path.join(args.out_dir, f"{args.scene}_compare.png"),
    )
    save_png(result["bloom"], os.path.join(args.out_dir, f"{args.scene}_bloom.png"))
    stats = summarize(result["source"], result["composite"], result["bloom"])
    print(json.dumps({"config": config.__dict__, "stats": stats}, indent=2))


if __name__ == "__main__":
    main()
