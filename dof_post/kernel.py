"""Bokeh sampling kernel: a filled, polygon-shaped point distribution.

Points follow a golden-angle spiral so the unit disk is covered evenly
with no gaps (prevents sampling holes in the blur). The disk is warped
into a regular polygon to emulate aperture blades, giving highlights a
bounded, well-defined bokeh shape.
"""

from __future__ import annotations

import numpy as np

GOLDEN_ANGLE = np.pi * (3.0 - np.sqrt(5.0))


def bokeh_kernel(
    radius: float,
    num_samples: int = 64,
    blades: int = 6,
    rotation: float = 0.0,
) -> np.ndarray:
    """Return (num_samples, 2) integer pixel offsets filling a polygon.

    ``radius`` is the kernel support in pixels; ``blades`` < 3 yields a
    plain disk. Offsets are rounded to integer pixels and de-duplicated
    so every tap is unique.
    """
    idx = np.arange(num_samples, dtype=np.float64)
    r = np.sqrt((idx + 0.5) / num_samples)  # uniform area distribution
    theta = idx * GOLDEN_ANGLE + rotation

    if blades >= 3:
        # Warp disk radius to a regular polygon with the given blade count.
        sector = 2.0 * np.pi / blades
        r = r * (np.cos(sector / 2.0) / np.cos(np.mod(theta, sector) - sector / 2.0))

    offsets = np.stack([r * np.cos(theta), r * np.sin(theta)], axis=1)
    offsets *= float(radius)
    offsets = np.round(offsets).astype(np.int32)
    offsets = np.unique(offsets, axis=0)
    return offsets
