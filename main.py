"""Render the DoF demo: depth / CoC / colour triptychs and a focus sweep.

Usage:
    python3 main.py                      # near + far focus panels + sweep
    python3 main.py --focus 8 --f-number 1.8
    python3 main.py --sweep-frames 8     # frames for the near-to-far switch
"""

from __future__ import annotations

import argparse
import os
import time

import numpy as np

from dof_post import DofSettings, LensSettings, apply_dof, render_scene
from dof_post.visualize import (coc_image, depth_image, save_image, tonemap,
                                triptych)

OUT_DIR = "outputs"


def render_frame(color: np.ndarray, depth: np.ndarray, focus: float,
                 f_number: float, samples: int, tag: str) -> np.ndarray:
    """Render one focus setting and save depth/CoC/colour + triptych."""
    lens = LensSettings(focus_distance=focus, f_number=f_number,
                        max_coc_near=12.0, max_coc_far=16.0)
    settings = DofSettings(num_samples=samples, blades=6,
                           highlight_threshold=1.0, highlight_gain=3.0)
    t0 = time.time()
    out, signed = apply_dof(color, depth, lens, settings)
    elapsed = time.time() - t0

    depth_u8 = depth_image(depth)
    coc_u8 = coc_image(signed, lens)
    color_u8 = tonemap(out)
    save_image(depth_u8, os.path.join(OUT_DIR, f"depth_{tag}.png"))
    save_image(coc_u8, os.path.join(OUT_DIR, f"coc_{tag}.png"))
    save_image(color_u8, os.path.join(OUT_DIR, f"color_{tag}.png"))
    panel = triptych(depth_u8, coc_u8, color_u8)
    save_image(panel, os.path.join(OUT_DIR, f"panel_{tag}.png"))
    print(f"focus={focus:5.2f}m  f/{f_number:<4} -> panel_{tag}.png "
          f"({elapsed:.2f}s)")
    return color_u8


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--focus", type=float, default=None,
                        help="single focus distance in metres")
    parser.add_argument("--f-number", type=float, default=2.0)
    parser.add_argument("--samples", type=int, default=256)
    parser.add_argument("--sweep-frames", type=int, default=6,
                        help="frames for the near-to-far focus switch")
    parser.add_argument("--height", type=int, default=360)
    parser.add_argument("--width", type=int, default=640)
    args = parser.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    color, depth = render_scene(args.height, args.width)

    if args.focus is not None:
        render_frame(color, depth, args.focus, args.f_number,
                     args.samples, "custom")
        return

    # Acceptance pair: focus on the near subject, then on the far subject.
    render_frame(color, depth, 2.0, args.f_number, args.samples, "focus_near")
    render_frame(color, depth, 8.0, args.f_number, args.samples, "focus_far")

    # Focus switch test: sweep near to far and assemble an animated GIF.
    from PIL import Image

    frames = []
    n = max(args.sweep_frames, 2)
    for i in range(n):
        focus = 2.0 + (8.0 - 2.0) * i / (n - 1)
        tag = f"sweep_{i:02d}"
        frame = render_frame(color, depth, focus, args.f_number,
                             args.samples, tag)
        frames.append(Image.fromarray(frame))
    gif_path = os.path.join(OUT_DIR, "focus_sweep.gif")
    frames[0].save(gif_path, save_all=True, append_images=frames[1:],
                   duration=350, loop=0)
    print(f"focus sweep GIF -> {gif_path}")


if __name__ == "__main__":
    main()
