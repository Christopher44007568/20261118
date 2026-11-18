"""Screen-space reflection: ray march + binary refinement.

Algorithm (all pixels processed in vectorized lockstep):

1. Reconstruct the camera-space position from the G-buffer depth and reflect
   the view ray about the interpolated normal.
2. March the reflected ray in screen space. Every sample looks up the linear
   depth buffer at the projected pixel.
3. Classify each sample:
       ray depth < surface depth - self_bias   -> still in front, safe
       |delta| <= thickness                     -> surface crossing (hit)
       ray depth > surface depth + thickness    -> behind a foreground
                                                   occluder (MISS, occluded)
4. Binary-search the last in-front / first-behind interval to pin the hit
   to sub-pixel precision.
5. Rays that leave the screen, or were swallowed by a foreground occluder,
   return a miss reason and the caller falls back to the environment ambient
   term. A separate ``naive`` mode deliberately samples the last available
   pixel to demonstrate why that fallback is mandatory.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import mat as m
from .rasterizer import GBuffer
from .shading import environment_color

HIT = 0
MISS_SCREEN_EXIT = 1
MISS_OCCLUDED = 2


@dataclass
class SSRResult:
    hit: np.ndarray  # (H, W) bool
    miss_reason: np.ndarray  # (H, W) int8, -1 where hit
    hit_uv: np.ndarray  # (H, W, 2) sampled reflection coordinate
    steps: np.ndarray  # (H, W) int32 coarse march iterations used
    edge_fade: np.ndarray  # (H, W) 0 at screen border, 1 well inside
    coarse_steps: np.ndarray  # (H, W) int32 march iterations
    refine_steps: np.ndarray  # (H, W) int32 binary refinement iterations


def _edge_fade(uv: np.ndarray, margin: float = 0.08) -> np.ndarray:
    """Smoothly fade reflection weight near the screen border."""
    q = np.minimum(uv, 1.0 - uv) / margin
    q = np.clip(q, 0.0, 1.0)
    return q[..., 0] * q[..., 1]


def reconstruct_view_pos(gbuffer: GBuffer) -> np.ndarray:
    """Rebuild camera-space xyz from linear depth using the inverse projection."""
    h, w = gbuffer.height, gbuffer.width
    u = (np.arange(w, dtype=np.float64) + 0.5) / w * 2.0 - 1.0
    v = 1.0 - (np.arange(h, dtype=np.float64) + 0.5) / h * 2.0
    ndc_x, ndc_y = np.meshgrid(u, v)
    ndc = np.stack([ndc_x, ndc_y, -np.ones_like(ndc_x), np.ones_like(ndc_x)], axis=-1)
    view = ndc @ gbuffer.inv_proj.T
    view = view[..., :3] / view[..., 3:4]
    scale = gbuffer.depth / np.maximum(-view[..., 2], 1e-9)
    return view * scale[..., None]


def _frustum_exit_t(origin: np.ndarray, direction: np.ndarray,
                    inv_proj: np.ndarray) -> np.ndarray:
    """Parameter t where each camera-space ray leaves the view frustum.

    A point ``o + t*d`` projects to NDC; we solve the smallest positive t
    for which |ndc.x|=1, |ndc.y|=1 or the near plane is crossed.
    """
    proj = np.linalg.inv(inv_proj)
    ho = np.concatenate([origin, np.ones(origin.shape[:-1] + (1,))], axis=-1)
    hd = np.concatenate([direction, np.zeros(direction.shape[:-1] + (1,))], axis=-1)
    clip_o = ho @ proj.T
    clip_d = hd @ proj.T
    t = np.full(origin.shape[:-1], 1e6, dtype=np.float64)
    for clip_axis in range(2):  # ndc x and y against +-w
        a = clip_d[..., clip_axis] - clip_d[..., 3]
        b = clip_o[..., clip_axis] - clip_o[..., 3]
        c = clip_d[..., clip_axis] + clip_d[..., 3]
        d = clip_o[..., clip_axis] + clip_o[..., 3]
        for num, den in ((b, -a), (d, -c)):
            valid = np.abs(den) > 1e-12
            cand = np.where(valid, num / np.where(valid, den, np.nan), np.nan)
            t = np.where((cand > 1e-6) & (cand < t), cand, t)
    # Near plane: clip w = 0 (camera-space z = -z_near).
    den = clip_d[..., 3]
    valid = np.abs(den) > 1e-12
    cand = np.where(valid, -clip_o[..., 3] / np.where(valid, den, np.nan), np.nan)
    t = np.where((cand > 1e-6) & (cand < t), cand, t)
    return t


def sample_depth_bilinear(depth: np.ndarray, uv: np.ndarray) -> np.ndarray:
    """Bilinear linear-depth lookup; returns 0 outside the screen."""
    h, w = depth.shape
    x = np.nan_to_num(uv[..., 0], nan=-1.0) * w - 0.5
    y = np.nan_to_num(uv[..., 1], nan=-1.0) * h - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    in_bounds = (x0 >= 0) & (y0 >= 0) & (x0 < w - 1) & (y0 < h - 1) & \
                np.isfinite(x) & np.isfinite(y)
    x0c = np.clip(x0, 0, w - 2)
    y0c = np.clip(y0, 0, h - 2)
    fx = (x - x0c)[..., None]
    fy = (y - y0c)[..., None]
    top = depth[y0c, x0c][..., None] * (1 - fx) + \
        depth[y0c, x0c + 1][..., None] * fx
    bot = depth[y0c + 1, x0c][..., None] * (1 - fx) + \
        depth[y0c + 1, x0c + 1][..., None] * fx
    value = (top * (1 - fy) + bot * fy)[..., 0]
    return np.where(in_bounds, value, 0.0)


def project_to_uv(points_view: np.ndarray, proj: np.ndarray) -> np.ndarray:
    """Project camera-space points to screen uv in [0, 1]."""
    homog = np.concatenate(
        [points_view, np.ones(points_view.shape[:-1] + (1,))], axis=-1)
    clip = homog @ proj.T
    w = np.where(np.abs(clip[..., 3:4]) > 1e-9, clip[..., 3:4], np.nan)
    ndc = clip[..., :2] / w
    return np.concatenate([ndc[..., 0:1] * 0.5 + 0.5,
                           0.5 - ndc[..., 1:2] * 0.5], axis=-1)


def trace_reflections(
    gbuffer: GBuffer,
    proj: np.ndarray,
    max_steps: int = 48,
    refine_steps: int = 6,
    thickness_scale: float = 0.05,
    self_bias_scale: float = 0.01,
    max_ray_distance: float = 30.0,
    jitter: np.ndarray | None = None,
) -> SSRResult:
    """Screen-space DDA march with adaptive depth tolerance and refinement.

    Every iteration advances each ray by a fixed number of screen pixels, so
    sampling density is uniform in screen space regardless of ray length.
    Linear depth along the ray changes smoothly between samples, which keeps
    the flat-floor self-intersection test stable and removes row banding.
    """
    h, w = gbuffer.height, gbuffer.width
    shaded = gbuffer.material_id >= 0
    origin = reconstruct_view_pos(gbuffer)
    view_ray = m.normalize(origin)
    reflect_dir = m.normalize(
        view_ray - 2.0 * gbuffer.view_normal *
        np.sum(view_ray * gbuffer.view_normal, axis=-1, keepdims=True))

    t_exit = _frustum_exit_t(origin, reflect_dir, gbuffer.inv_proj)
    t_end = np.clip(np.minimum(t_exit, max_ray_distance), 0.1, max_ray_distance)
    if jitter is None:
        jitter = np.zeros((h, w), dtype=np.float64)

    state = np.full((h, w), -1, dtype=np.int8)  # -1 active, 0 hit, 1 exit, 2 occ
    steps_used = np.zeros((h, w), dtype=np.int32)
    cross_uv = np.zeros((h, w, 2), dtype=np.float64)
    safe_uv = np.zeros((h, w, 2), dtype=np.float64)
    active = shaded.copy()

    # Hybrid march: exponential world-space t (dense near the shading point,
    # sparse far away) projected to screen uv each iteration, with bilinear
    # depth lookup. This resolves close contacts accurately while long rays
    # still cross the whole screen inside the step budget.
    t0 = 0.1
    growth = (t_end / t0) ** (1.0 / max_steps)
    has_safe = np.zeros((h, w), dtype=bool)

    for step in range(max_steps):
        if not np.any(active):
            break
        frac = np.clip((step + 0.5 + jitter) / max_steps, 0.0, 0.999)
        t = t0 * growth ** (frac * max_steps)
        points = origin + reflect_dir * t[..., None]
        uv = project_to_uv(points, proj)
        surface_depth = sample_depth_bilinear(gbuffer.depth, uv)
        ray_depth = -points[..., 2]
        in_bounds = (uv[..., 0] > 0) & (uv[..., 0] < 1) & \
                    (uv[..., 1] > 0) & (uv[..., 1] < 1) & \
                    (surface_depth > 0.0)
        # Geometric tolerance in world depth units, scaled by pixel footprint.
        pixel_footprint = surface_depth * (2.0 * np.tan(np.deg2rad(30.0)) /
                                           gbuffer.height)
        # Depth-relative tolerances, with the pixel footprint only capping
        # the lower end. This keeps the bias tight near the shading point
        # (where the ray must not self-intersect) while distant, sub-pixel
        # geometry still gets a workable crossing band.
        self_bias = np.maximum(surface_depth * self_bias_scale,
                               np.minimum(pixel_footprint * 0.5,
                                          surface_depth * 0.02))
        thickness = np.maximum(surface_depth * thickness_scale,
                               np.minimum(pixel_footprint,
                                          surface_depth * 0.05))
        delta = ray_depth - surface_depth  # >0 means ray is behind surface

        steps_used[active] = step + 1

        # Case 1: ray left the screen (or ran past max distance) -> exit miss.
        exited = active & ~in_bounds
        state[exited] = MISS_SCREEN_EXIT

        # Case 2: ray jumped well beyond the sampled surface -> foreground
        # occluder swallows the target. Checked before the hit band.
        occluded = active & in_bounds & has_safe & (delta > thickness)
        state[occluded] = MISS_OCCLUDED
        cross_uv[occluded] = safe_uv[occluded]

        # Case 3: crossed into the surface within its thickness band -> hit.
        hit_now = active & in_bounds & (delta >= -self_bias) & (delta <= thickness)
        state[hit_now] = HIT
        cross_uv[hit_now] = safe_uv[hit_now]

        # Case 4: still safely in front of the sampled surface.
        safe_now = active & in_bounds & (delta < -self_bias)
        safe_uv[safe_now] = uv[safe_now]
        has_safe |= safe_now

        active = state == -1

    # Rays exhausting the budget inside the frustum count as exit misses.
    state[active] = MISS_SCREEN_EXIT

    hit_uv, binary_steps = _binary_refine_t(
        gbuffer, proj, origin, reflect_dir, t0, t_end, state == HIT,
        refine_steps, thickness_scale, self_bias_scale)

    # Occluded / exit pixels remember their last safe sample for the
    # deliberately-wrong "naive" visualization.
    hit_uv = np.where((state == HIT)[..., None], hit_uv, safe_uv)
    had_sample = np.any(safe_uv != 0.0, axis=-1)
    hit_uv = np.where(
        ((state != HIT) & ~had_sample)[..., None], 0.0, hit_uv)

    return SSRResult(
        hit=state == HIT,
        miss_reason=np.where(state == HIT, -1, state).astype(np.int8),
        hit_uv=hit_uv,
        steps=steps_used + binary_steps,
        edge_fade=_edge_fade(hit_uv),
        coarse_steps=steps_used,
        refine_steps=binary_steps,
    )


def _binary_refine_t(
    gbuffer: GBuffer,
    proj: np.ndarray,
    origin: np.ndarray,
    direction: np.ndarray,
    t_near: float,
    t_far: np.ndarray,
    hit_mask: np.ndarray,
    iterations: int,
    thickness_scale: float,
    self_bias_scale: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Narrow the in-front / behind t bracket to sub-pixel precision.

    The coarse march guarantees a sign change somewhere in [t_near, t_far];
    bisection on the signed depth delta converges to the surface crossing.
    """
    lo = np.where(hit_mask, t_near, 0.0)
    hi = np.where(hit_mask, t_far, 1.0)
    binary_steps = np.zeros((gbuffer.height, gbuffer.width), dtype=np.int32)
    active = hit_mask.copy()
    for _ in range(iterations):
        if not np.any(active):
            break
        mid = 0.5 * (lo + hi)
        points = origin + direction * mid[..., None]
        uv = project_to_uv(points, proj)
        surface_depth = sample_depth_bilinear(gbuffer.depth, uv)
        ray_depth = -points[..., 2]
        in_bounds = surface_depth > 0.0
        pixel_footprint = surface_depth * (2.0 * np.tan(np.deg2rad(30.0)) /
                                           gbuffer.height)
        self_bias = np.maximum(surface_depth * self_bias_scale,
                               np.minimum(pixel_footprint * 0.5,
                                          surface_depth * 0.02))
        delta = ray_depth - surface_depth
        behind = active & in_bounds & (delta >= -self_bias)
        front = active & in_bounds & ~behind
        hi[behind] = mid[behind]
        lo[front] = mid[front]
        binary_steps[active] += 1
        active = active & in_bounds
    final_points = origin + direction * hi[..., None]
    return project_to_uv(final_points, proj), binary_steps


def sample_color(image: np.ndarray, uv: np.ndarray) -> np.ndarray:
    """Bilinear colour lookup; returns zero outside the screen."""
    h, w = image.shape[:2]
    x = uv[..., 0] * w - 0.5
    y = uv[..., 1] * h - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    in_bounds = (x0 >= 0) & (y0 >= 0) & (x0 < w - 1) & (y0 < h - 1)
    x0c = np.clip(x0, 0, w - 2)
    y0c = np.clip(y0, 0, h - 2)
    fx = (x - x0c)[..., None]
    fy = (y - y0c)[..., None]
    top = image[y0c, x0c] * (1 - fx) + image[y0c, x0c + 1] * fx
    bot = image[y0c + 1, x0c] * (1 - fx) + image[y0c + 1, x0c + 1] * fx
    color = top * (1 - fy) + bot * fy
    return np.where(in_bounds[..., None], color, 0.0)


def _roughness_kernel(roughness: np.ndarray) -> np.ndarray:
    """Map roughness to a screen-space box blur radius in pixels."""
    return np.rint(np.clip(roughness, 0.0, 1.0) * 4.0).astype(np.int64)


def roughness_blur(image: np.ndarray, radius: np.ndarray) -> np.ndarray:
    """Per-pixel variable-radius box blur via a handful of fixed passes."""
    out = image.copy()
    max_radius = int(radius.max())
    padded = np.pad(image, ((max_radius, max_radius), (max_radius, max_radius),
                            (0, 0)), mode="edge")
    h, w = image.shape[:2]
    acc = np.zeros_like(image)
    weight = np.zeros((h, w), dtype=np.float64)
    for dy in range(-max_radius, max_radius + 1):
        for dx in range(-max_radius, max_radius + 1):
            inside = (np.abs(dy) <= radius) & (np.abs(dx) <= radius)
            patch = padded[max_radius + dy:max_radius + dy + h,
                           max_radius + dx:max_radius + dx + w]
            acc += patch * inside[..., None]
            weight += inside.astype(np.float64)
    return acc / np.maximum(weight[..., None], 1.0)


def reflection_colors(
    gbuffer: GBuffer,
    result: SSRResult,
    reflect_dir: np.ndarray,
    base_color: np.ndarray,
) -> dict[str, np.ndarray]:
    """Build the reflection buffer under the correct and naive policies."""
    env = environment_color(reflect_dir)
    tint = np.where(
        gbuffer.metallic[..., None] > 0.5,
        gbuffer.albedo * 0.8 + 0.2,
        np.ones_like(gbuffer.albedo),
    )
    screen_color = sample_color(base_color, result.hit_uv)
    screen_color = roughness_blur(screen_color, _roughness_kernel(gbuffer.roughness))

    # Correct policy: hits sample the scene, every miss falls back to ambient.
    correct = np.where(result.hit[..., None], screen_color, env * tint)
    # Light spatial denoise suppresses single-pixel classification noise at
    # the screen-exit horizon without smearing valid object reflections.
    correct = box_blur(correct, radius=1)

    # Naive policy: misses blindly reuse the last sampled pixel. Pixels that
    # never had a valid sample get black - the "wrong colour" failure mode.
    had_sample = np.any(result.hit_uv != 0.0, axis=-1)
    wrong = np.where(
        (result.miss_reason >= 0)[..., None] & had_sample[..., None],
        screen_color,
        correct,
    )
    wrong = np.where(
        (result.miss_reason >= 0)[..., None] & ~had_sample[..., None],
        0.0,
        wrong,
    )
    return {"correct": correct, "naive": wrong, "env": env * tint}


def box_blur(image: np.ndarray, radius: int = 1) -> np.ndarray:
    """Uniform small-kernel box blur used as reflection denoiser."""
    if radius <= 0:
        return image
    padded = np.pad(image, ((radius, radius), (radius, radius), (0, 0)),
                    mode="edge")
    acc = np.zeros_like(image)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            acc += padded[radius + dy:radius + dy + image.shape[0],
                          radius + dx:radius + dx + image.shape[1]]
    return acc / (2 * radius + 1) ** 2


def compose(
    gbuffer: GBuffer,
    direct: np.ndarray,
    reflection: np.ndarray,
    result: SSRResult,
    include_edge_fade: bool = True,
) -> np.ndarray:
    """Final composite: direct colour plus weight-modulated reflection."""
    from .shading import reflection_strength

    weight = reflection_strength(gbuffer)
    if include_edge_fade:
        weight *= result.edge_fade
    shaded = gbuffer.material_id >= 0
    color = direct + reflection * weight[..., None]
    return np.where(shaded[..., None], color, 0.0)


def reflection_direction(gbuffer: GBuffer) -> np.ndarray:
    origin = reconstruct_view_pos(gbuffer)
    view_ray = m.normalize(origin)
    return m.normalize(
        view_ray - 2.0 * gbuffer.view_normal *
        np.sum(view_ray * gbuffer.view_normal, axis=-1, keepdims=True))
