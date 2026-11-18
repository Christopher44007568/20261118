"""离屏运行整条相机航迹，输出对比视频、逐帧统计与关键帧。"""

from __future__ import annotations

import argparse
import csv
import os

import imageio.v2 as imageio
import moderngl
import numpy as np

from .hud import HudOverlay
from .renderer import DemoRenderer


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="GPU 遮挡查询保守剔除演示")
    p.add_argument("--frames", type=int, default=240)
    p.add_argument("--width", type=int, default=960)
    p.add_argument("--height", type=int, default=540)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--out-dir", default="out")
    return p.parse_args()


def run() -> None:
    args = parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    ctx = moderngl.create_standalone_context(backend="egl")
    ctx.enable(moderngl.DEPTH_TEST)

    renderer = DemoRenderer(ctx, args.width, args.height)
    hud = HudOverlay(ctx, args.width, args.height)
    video_path = os.path.join(args.out_dir, "occlusion_demo.mp4")
    diff_path = os.path.join(args.out_dir, "occlusion_diff.mp4")
    stats_path = os.path.join(args.out_dir, "frame_stats.csv")
    writer = imageio.get_writer(video_path, fps=args.fps, codec="libx264",
                                quality=8, macro_block_size=None)
    diff_writer = imageio.get_writer(diff_path, fps=args.fps, codec="libx264",
                                     quality=8, macro_block_size=None)

    stats_rows = []
    key_frames = {0, args.frames // 4, args.frames // 2,
                  3 * args.frames // 4, args.frames - 1}
    try:
        for frame in range(args.frames):
            stats = renderer.render_frame(frame, args.frames)
            diff_rgb = renderer.snapshot_diff()
            diff_writer.append_data(diff_rgb)
            hud.update(stats, len(renderer.targets))
            renderer.main_fbo.fbo.use()
            ctx.enable(ctx.BLEND)
            ctx.blend_func = (ctx.SRC_ALPHA, ctx.ONE_MINUS_SRC_ALPHA)
            renderer.quad.blit_texture(hud.gl_texture)
            ctx.disable(ctx.BLEND)
            frame_rgb = np.frombuffer(
                renderer.main_fbo.fbo.read(components=3), dtype=np.uint8
            ).reshape(args.height, args.width, 3)
            writer.append_data(frame_rgb)
            stats_rows.append(stats)
            if frame in key_frames:
                imageio.imwrite(
                    os.path.join(args.out_dir, f"frame_{frame:03d}.png"), frame_rgb)
    finally:
        writer.close()
        diff_writer.close()

    fieldnames = list(stats_rows[0].__dict__.keys())
    with open(stats_path, "w", newline="") as fh:
        writer_csv = csv.DictWriter(fh, fieldnames=fieldnames)
        writer_csv.writeheader()
        for stats in stats_rows:
            writer_csv.writerow(stats.__dict__)

    total_ref = sum(s.reference_draws for s in stats_rows)
    total_actual = sum(s.target_draws for s in stats_rows)
    worst_diff = max(s.diff_pixels for s in stats_rows)
    print(f"video:      {video_path}")
    print(f"diff video: {diff_path}")
    print(f"stats:      {stats_path}")
    print(f"target draw calls: culled={total_actual} reference={total_ref} "
          f"saved={total_ref - total_actual} "
          f"({100.0 * (total_ref - total_actual) / max(total_ref, 1):.1f}%)")
    print(f"worst per-frame pixel diff: {worst_diff}")


if __name__ == "__main__":
    run()
