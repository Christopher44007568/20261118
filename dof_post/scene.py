"""Procedural HDR test scene with a known depth map.

Layout (camera at origin, depth in metres):
  - sky gradient + distant bright point lights   25..40 m  (bokeh sources)
  - ground plane, perspective depth gradient      3..40 m  (continuity test)
  - far subject: striped sign board               8 m
  - near subject: checker-pattern disc            2 m
  - foreground occluders: dark leaves, corners    1.1 m

The two subjects carry fine high-frequency detail so focus sharpness can
be measured; the ground gives a smooth depth ramp for checking that blur
transitions stay continuous.
"""

from __future__ import annotations

import numpy as np

FAR_PLANE = 40.0


def _canvas(h: int, w: int) -> tuple[np.ndarray, np.ndarray]:
    color = np.zeros((h, w, 3), dtype=np.float32)
    depth = np.full((h, w), FAR_PLANE, dtype=np.float32)
    return color, depth


def _blend(color: np.ndarray, depth: np.ndarray, rgb, alpha: np.ndarray,
           z: float) -> None:
    """Alpha-composite a layer and stamp its depth."""
    a = alpha[..., None].astype(np.float32)
    color *= 1.0 - a
    color += a * np.asarray(rgb, dtype=np.float32)
    np.copyto(depth, np.float32(z), where=alpha > 0.5)


def _disc(h: int, w: int, cx: float, cy: float, r: float,
          feather: float = 1.0) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot(xx - cx, yy - cy)
    return np.clip(r - d + feather * 0.5, 0.0, 1.0).astype(np.float32)


def _rect(h: int, w: int, x0: float, y0: float, x1: float, y1: float,
          feather: float = 1.0) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w]
    inside = np.minimum(np.minimum(xx - x0, x1 - xx),
                        np.minimum(yy - y0, y1 - yy))
    return np.clip(inside + feather * 0.5, 0.0, 1.0).astype(np.float32)


def render_scene(h: int = 360, w: int = 640,
                 seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """Render the test scene. Returns (linear HDR colour, depth metres)."""
    rng = np.random.default_rng(seed)
    color, depth = _canvas(h, w)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    horizon = 0.52 * h

    # --- sky gradient (depth = far plane) ---
    t = np.clip(yy / max(horizon, 1.0), 0.0, 1.0)[..., None]
    sky = (1.0 - t) * np.array([0.55, 0.70, 0.95]) + t * np.array(
        [0.95, 0.80, 0.62])
    color += sky

    # --- ground plane with perspective depth ramp ---
    ground = yy > horizon
    gt = np.clip((yy - horizon) / max(h - horizon, 1.0), 1e-3, 1.0)
    ground_z = np.clip(2.6 / gt, 2.6, FAR_PLANE)
    checker = ((np.floor(xx / 28.0) + np.floor(yy / 28.0)) % 2.0)
    gcol = 0.28 + 0.10 * checker
    fade = np.clip(ground_z / FAR_PLANE, 0.0, 1.0)[..., None]
    gcol = gcol[..., None] * np.array([0.55, 0.62, 0.45]) * (1.0 - 0.6 * fade)
    color = np.where(ground[..., None], gcol, color)
    np.copyto(depth, ground_z.astype(np.float32), where=ground)

    # --- distant bright point lights (bokeh sources) ---
    for _ in range(26):
        lx = rng.uniform(0.03, 0.97) * w
        ly = rng.uniform(0.04, 0.48) * h
        lr = rng.uniform(1.2, 3.0)
        lz = rng.uniform(24.0, 38.0)
        warm = rng.uniform(2.5, 6.0)
        tint = np.array([1.0, rng.uniform(0.55, 0.95), rng.uniform(0.35, 0.9)])
        alpha = _disc(h, w, lx, ly, lr)
        _blend(color, depth, tint * warm, alpha, lz)

    # --- far subject: striped sign board at 8 m ---
    bx0, by0, bx1, by1 = 0.60 * w, 0.30 * h, 0.86 * w, 0.62 * h
    board = _rect(h, w, bx0, by0, bx1, by1)
    stripes = 0.5 + 0.5 * np.sign(np.sin((xx - bx0) * 0.9))
    board_rgb = np.stack([0.85 - 0.55 * stripes,
                          0.30 + 0.45 * stripes,
                          0.25 + 0.10 * stripes], axis=-1)
    _blend(color, depth, board_rgb, board, 8.0)

    # --- near subject: checker disc at 2 m ---
    cx, cy, cr = 0.30 * w, 0.55 * h, 0.17 * h
    disc = _disc(h, w, cx, cy, cr)
    cells = ((np.floor((xx - cx) / 9.0) + np.floor((yy - cy) / 9.0)) % 2.0)
    disc_rgb = np.stack([0.90 - 0.70 * cells,
                         0.75 - 0.55 * cells,
                         0.30 + 0.55 * cells], axis=-1)
    _blend(color, depth, disc_rgb, disc, 2.0)

    # --- foreground occluders: dark leaves in the corners at 1.1 m ---
    for (lx, ly, lr) in [(0.02 * w, 0.95 * h, 0.20 * h),
                         (0.98 * w, 0.90 * h, 0.17 * h),
                         (0.06 * w, 0.10 * h, 0.13 * h)]:
        leaf = _disc(h, w, lx, ly, lr)
        _blend(color, depth, np.array([0.05, 0.09, 0.04]), leaf, 1.1)

    return color, depth
