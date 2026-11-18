"""End-to-end render: G-buffer -> direct pass -> SSR -> composite."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import mat as m
from . import shading, ssr
from .rasterizer import GBuffer, RenderObject, rasterize
from .scenarios import Camera


@dataclass
class FrameResult:
    gbuffer: GBuffer
    direct: np.ndarray
    result: ssr.SSRResult
    reflect_dir: np.ndarray
    correct_composite: np.ndarray
    naive_composite: np.ndarray
    reflection_only: np.ndarray
    ambient_only: np.ndarray
    metrics: dict = field(default_factory=dict)


def render_frame(
    objects: list[RenderObject],
    camera: Camera,
    width: int = 480,
    height: int = 360,
    max_steps: int = 48,
    refine_steps: int = 6,
    thickness_scale: float = 0.05,
) -> FrameResult:
    aspect = width / height
    proj = m.perspective(np.deg2rad(60.0), aspect, 0.1, 120.0)
    view = m.look_at(camera.eye, camera.target, np.array([0.0, 1.0, 0.0]))

    gbuffer = rasterize(objects, width, height, proj, view)
    direct = shading.direct_lighting(gbuffer)
    reflect_dir = ssr.reflection_direction(gbuffer)

    result = ssr.trace_reflections(
        gbuffer, proj, max_steps=max_steps, refine_steps=refine_steps,
        thickness_scale=thickness_scale)
    colors = ssr.reflection_colors(gbuffer, result, reflect_dir, direct)

    correct = ssr.compose(gbuffer, direct, colors["correct"], result)
    naive = _naive_composite(gbuffer, direct, colors["naive"], result)

    from .shading import reflection_strength
    weight = reflection_strength(gbuffer) * result.edge_fade
    reflection_only = np.where(
        gbuffer.material_id[..., None] >= 0,
        colors["correct"] * weight[..., None], 0.0)
    ambient_only = np.where(
        gbuffer.material_id[..., None] >= 0,
        colors["env"] * weight[..., None], 0.0)

    metrics = _collect_metrics(gbuffer, result)
    return FrameResult(
        gbuffer, direct, result, reflect_dir, correct, naive,
        reflection_only, ambient_only, metrics)


def _naive_composite(gbuffer: GBuffer, direct: np.ndarray,
                     reflection: np.ndarray, result: ssr.SSRResult) -> np.ndarray:
    """Wrong-pixel composite: no edge fade and no ambient fallback."""
    from .shading import reflection_strength

    weight = reflection_strength(gbuffer)
    shaded = gbuffer.material_id >= 0
    return np.where(shaded[..., None], direct + reflection * weight[..., None], 0.0)


def _collect_metrics(gbuffer: GBuffer, result: ssr.SSRResult) -> dict:
    shaded = gbuffer.material_id >= 0
    total = int(shaded.sum())
    hits = int((result.hit & shaded).sum())
    exit_miss = int(((result.miss_reason == ssr.MISS_SCREEN_EXIT) & shaded).sum())
    occ_miss = int(((result.miss_reason == ssr.MISS_OCCLUDED) & shaded).sum())
    steps = result.steps[shaded]
    coarse = result.coarse_steps[shaded]
    refine = result.refine_steps[shaded]
    return {
        "shaded_pixels": total,
        "hit_pixels": hits,
        "screen_exit_miss": exit_miss,
        "occluded_miss": occ_miss,
        "hit_rate": hits / max(total, 1),
        "screen_exit_rate": exit_miss / max(total, 1),
        "occluded_rate": occ_miss / max(total, 1),
        "avg_coarse_steps": float(coarse.mean()) if total else 0.0,
        "avg_refine_steps": float(refine.mean()) if total else 0.0,
        "avg_total_steps": float(steps.mean()) if total else 0.0,
        "max_coarse_steps": int(coarse.max()) if total else 0,
        "max_refine_steps": int(refine.max()) if total else 0,
        "median_total_steps": float(np.median(steps)) if total else 0.0,
        "step_budget": int(result.coarse_steps.max() + result.refine_steps.max()),
    }


def wrong_pixel_count(frame: FrameResult) -> dict:
    """How many miss pixels carry a sampled (potentially wrong) colour."""
    gbuffer = frame.gbuffer
    miss = frame.result.miss_reason >= 0
    had_sample = np.any(frame.result.hit_uv != 0.0, axis=-1)
    wrong = miss & had_sample & (gbuffer.material_id >= 0)
    black = miss & ~had_sample & (gbuffer.material_id >= 0)
    diff = np.abs(frame.naive_composite - frame.correct_composite).sum(axis=-1)
    return {
        "wrong_sampled_pixels": int(wrong.sum()),
        "black_pixels": int(black.sum()),
        "pixels_affected": int(((diff > 0.02) & (gbuffer.material_id >= 0)).sum()),
        "mean_color_error_on_miss": float(
            diff[miss & (gbuffer.material_id >= 0)].mean()
            if np.any(miss) else 0.0),
    }
