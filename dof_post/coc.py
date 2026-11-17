"""Circle-of-confusion (CoC) computation for the DoF post-process.

Uses the thin-lens model. The signed CoC (in pixels) is negative for the
foreground (nearer than the focus distance) and positive for the
background. Foreground and background magnitudes are clamped by separate
radii so the two fields can be blurred with different strengths.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class LensSettings:
    """Camera lens parameters controlling the depth-of-field effect."""

    focus_distance: float = 4.0   # metres, distance of the focal plane
    f_number: float = 2.0         # aperture f-number (smaller = blurrier)
    focal_length: float = 0.050   # metres
    max_coc_near: float = 12.0    # pixels, foreground blur radius limit
    max_coc_far: float = 20.0     # pixels, background blur radius limit
    # Sensor scale: px per metre of CoC. For a 36mm-full-frame-equivalent
    # sensor this is roughly image_width_px / 0.036.
    pixels_per_metre: float = 16000.0


def signed_coc(depth: np.ndarray, lens: LensSettings) -> np.ndarray:
    """Return the signed CoC diameter in pixels for each depth sample.

    Negative values belong to the foreground, positive to the background.
    Depths must be positive (metres). The result is clamped to
    [-max_coc_near, +max_coc_far].
    """
    depth = np.asarray(depth, dtype=np.float32)
    f = lens.focal_length
    focus = max(lens.focus_distance, f * 1.001)
    # Thin-lens CoC diameter on the sensor (metres):
    #   coc = f^2 / N * |d - df| / (d * (df - f))
    scale = (f * f) / lens.f_number
    coc_m = scale * np.abs(depth - focus) / (depth * (focus - f) + 1e-9)
    coc_px = coc_m * lens.pixels_per_metre
    signed = np.where(depth < focus, -coc_px, coc_px)
    return np.clip(signed, -lens.max_coc_near, lens.max_coc_far).astype(np.float32)


def split_fields(signed: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Split a signed CoC map into (near, far) non-negative radius maps."""
    near = np.maximum(-signed, 0.0)
    far = np.maximum(signed, 0.0)
    return near.astype(np.float32), far.astype(np.float32)
