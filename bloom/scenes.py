"""Synthetic HDR test scenes used to exercise the Bloom pipeline.

All scenes are returned as float32 RGB arrays whose values may exceed
1.0.  Three luminance regimes are covered:

* ``sun``      - a very hot, compact HDR source on a mid background.
* ``bulbs``    - several small emitters of different intensity/tint.
* ``dark_bg``  - weak emitters on a near-black background.
"""

from __future__ import annotations

import numpy as np


def _disc(height: int, width: int, cy: float, cx: float, radius: float) -> np.ndarray:
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    dist2 = (yy - cy) ** 2 + (xx - cx) ** 2
    return (dist2 <= radius * radius).astype(np.float32)


def _soft_disc(
    height: int, width: int, cy: float, cx: float, radius: float, feather: float
) -> np.ndarray:
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    dist = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    mask = np.clip((radius + feather - dist) / (2.0 * feather), 0.0, 1.0)
    return mask.astype(np.float32)


def sun_scene(height: int = 256, width: int = 256) -> np.ndarray:
    """Hot HDR sun (peak ~12x) over a dim sky gradient."""
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    vertical = yy / max(height - 1, 1)
    sky = np.stack(
        [
            0.10 + 0.12 * (1.0 - vertical),
            0.14 + 0.16 * (1.0 - vertical),
            0.22 + 0.25 * (1.0 - vertical),
        ],
        axis=-1,
    ).astype(np.float32)
    core = _disc(height, width, height * 0.32, width * 0.62, 14.0)
    halo = _soft_disc(height, width, height * 0.32, width * 0.62, 26.0, 8.0)
    image = sky.copy()
    image += (halo[..., None] * np.array([2.2, 1.7, 0.9], np.float32))
    image += (core[..., None] * np.array([12.0, 10.5, 7.0], np.float32))
    return image.astype(np.float32)


def bulbs_scene(height: int = 256, width: int = 256) -> np.ndarray:
    """Row of small bulbs with distinct brightness and colour temperature."""
    image = np.full((height, width, 3), 0.08, dtype=np.float32)
    bulbs = [
        (0.30, 0.22, 6.0, np.array([6.0, 2.4, 0.8])),   # warm bright
        (0.30, 0.50, 3.2, np.array([3.2, 3.6, 4.2])),   # cool medium
        (0.30, 0.78, 1.6, np.array([1.8, 1.2, 0.5])),   # dim warm
        (0.68, 0.36, 4.4, np.array([4.5, 4.0, 2.0])),   # neutral
        (0.68, 0.64, 2.2, np.array([0.6, 2.2, 3.4])),   # dim blue
    ]
    for cy, cx, radius, color in bulbs:
        core = _disc(height, width, height * cy, width * cx, radius)
        glow = _soft_disc(height, width, height * cy, width * cx, radius * 2.2, radius)
        image += glow[..., None] * (color * 0.35)
        image += core[..., None] * color
    return image.astype(np.float32)


def dark_bg_scene(height: int = 256, width: int = 256) -> np.ndarray:
    """Sparse faint emitters on an almost black background."""
    image = np.full((height, width, 3), 0.015, dtype=np.float32)
    specs = [
        (0.4, 0.3, 3.0, np.array([2.6, 2.2, 1.6])),
        (0.55, 0.55, 2.0, np.array([1.4, 1.6, 2.4])),
        (0.35, 0.72, 1.5, np.array([0.9, 0.7, 1.8])),
    ]
    for cy, cx, radius, color in specs:
        core = _disc(height, width, height * cy, width * cx, radius)
        image += core[..., None] * color
    return image.astype(np.float32)


SCENES = {
    "sun": sun_scene,
    "bulbs": bulbs_scene,
    "dark_bg": dark_bg_scene,
}
