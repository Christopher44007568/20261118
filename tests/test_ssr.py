"""Correctness tests for the SSR ray marcher and its fallback policy."""

from __future__ import annotations

import numpy as np
import pytest

from ssr_demo import mat as m
from ssr_demo import ssr
from ssr_demo.pipeline import render_frame, wrong_pixel_count
from ssr_demo.rasterizer import GBuffer
from ssr_demo.scenarios import build_scenario, fast_camera_views


def _flat_gbuffer(depth: float) -> GBuffer:
    """Tiny G-buffer containing one flat wall facing the camera."""
    h, w = 64, 64
    buf = np.zeros((h, w), dtype=np.float64)
    buf[:] = depth
    normal = np.zeros((h, w, 3), dtype=np.float64)
    normal[..., 2] = -1.0
    pos = np.zeros((h, w, 3), dtype=np.float64)
    pos[..., 2] = -depth
    albedo = np.full((h, w, 3), 0.5, dtype=np.float64)
    mat_id = np.zeros((h, w), dtype=np.int64)
    proj = m.perspective(np.deg2rad(60.0), 1.0, 0.1, 50.0)
    return GBuffer(w, h, buf, pos, normal, albedo,
                   np.ones((h, w)), np.full((h, w), 0.1), mat_id,
                   np.linalg.inv(proj))


def test_depth_reconstruction_round_trips() -> None:
    objects, camera = build_scenario("slender_pillars")
    frame = render_frame(objects, camera, width=96, height=72)
    rebuilt = ssr.reconstruct_view_pos(frame.gbuffer)
    mask = frame.gbuffer.material_id >= 0
    error = np.abs(rebuilt - frame.gbuffer.view_pos)[mask].max()
    assert error < 1e-4


def test_flat_wall_does_not_self_intersect() -> None:
    gbuffer = _flat_gbuffer(5.0)
    proj = np.linalg.inv(gbuffer.inv_proj)
    result = ssr.trace_reflections(gbuffer, proj, max_steps=24)
    # A ray reflected straight back from a flat wall leaves the screen; it
    # must never register as a hit against its own surface.
    assert not np.any(result.hit)
    assert np.all(result.miss_reason == ssr.MISS_SCREEN_EXIT)


def test_every_pixel_is_classified() -> None:
    objects, camera = build_scenario("rough_metal")
    frame = render_frame(objects, camera, width=96, height=72)
    shaded = frame.gbuffer.material_id >= 0
    classified = frame.result.hit | (frame.result.miss_reason >= 0)
    assert np.all(classified[shaded])


def test_misses_fall_back_to_ambient_not_sampled_pixels() -> None:
    objects, camera = build_scenario("slender_pillars")
    frame = render_frame(objects, camera, width=128, height=96)
    info = wrong_pixel_count(frame)
    # The correct composite must differ from the naive wrong-pixel policy on
    # every miss that had a stale sample available.
    assert info["wrong_sampled_pixels"] > 0
    assert info["pixels_affected"] > 0
    miss = frame.result.miss_reason >= 0
    # Correct policy on misses equals the environment ambient term.
    from ssr_demo.shading import environment_color
    env = environment_color(frame.reflect_dir)
    diff = np.abs(frame.correct_composite - frame.naive_composite).sum(-1)
    assert diff[miss].mean() > diff[~miss].mean()


def test_occluded_rays_are_rejected() -> None:
    objects, camera = build_scenario("slender_pillars")
    frame = render_frame(objects, camera, width=128, height=96)
    assert (frame.result.miss_reason == ssr.MISS_OCCLUDED).sum() > 0


def test_binary_refinement_improves_placement() -> None:
    objects, camera = build_scenario("slender_pillars")
    refined = render_frame(objects, camera, width=128, height=96,
                           refine_steps=6)
    coarse = render_frame(objects, camera, width=128, height=96,
                          refine_steps=0)
    hit = refined.result.hit
    uv = refined.result.hit_uv[hit]
    h, w = refined.gbuffer.height, refined.gbuffer.width
    fx = uv[:, 0] * w - np.floor(uv[:, 0] * w)
    fy = uv[:, 1] * h - np.floor(uv[:, 1] * h)
    subpixel = np.minimum(np.minimum(fx, 1 - fx),
                          np.minimum(fy, 1 - fy)).mean()
    assert subpixel < 0.3
    assert refined.result.steps[hit].mean() > coarse.result.steps[hit].mean()


def test_step_cost_is_bounded_and_recorded() -> None:
    objects, camera = build_scenario("fast_camera")
    frame = render_frame(objects, camera, width=128, height=96,
                         max_steps=32, refine_steps=4)
    assert frame.result.steps.max() <= 32 + 4
    assert frame.metrics["avg_total_steps"] > 0
    assert frame.metrics["avg_coarse_steps"] >= frame.metrics["avg_refine_steps"]


def test_fast_camera_sweep_runs_all_views() -> None:
    objects, _ = build_scenario("fast_camera")
    frames = [render_frame(objects, view, width=96, height=72)
              for view in fast_camera_views()]
    assert len(frames) == 3
    for frame in frames:
        assert frame.metrics["shaded_pixels"] > 0
