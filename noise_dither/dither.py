"""Color quantization with screen-space-stable dithering.

The dither field for a frame is `texture[y % H, x % W]` -- a pure
function of pixel coordinates. There is deliberately no time or
frame-index input, so the pattern cannot swim or flicker when the
camera moves; only the scene content under it changes.
"""

from __future__ import annotations

from enum import Enum

import numpy as np

from .bluenoise import bayer_matrix, blue_noise_texture, white_noise_texture


class DitherMode(Enum):
    NONE = "none"
    WHITE = "white"
    BLUE = "blue"
    BAYER = "bayer"  # negative control: periodic -> checkerboard blocks


_TEXTURE_CACHE: dict[tuple, np.ndarray] = {}


def get_texture(mode: DitherMode, size: int = 128, seed: int = 1337) -> np.ndarray:
    key = (mode, size, seed)
    if key not in _TEXTURE_CACHE:
        if mode is DitherMode.WHITE:
            tex = white_noise_texture(size, seed)
        elif mode is DitherMode.BLUE:
            tex = blue_noise_texture(size, seed)
        elif mode is DitherMode.BAYER:
            tex = bayer_matrix(3)
        else:
            raise ValueError(f"no texture for mode {mode}")
        _TEXTURE_CACHE[key] = tex
    return _TEXTURE_CACHE[key]


def dither_field(mode: DitherMode, height: int, width: int,
                 size: int = 128, seed: int = 1337) -> np.ndarray:
    """Screen-space threshold field for a frame of (height, width).

    Indexed strictly by (x, y) mod texture size -- camera-independent.
    """
    if mode is DitherMode.NONE:
        return np.full((height, width), 0.5)
    tex = get_texture(mode, size, seed)
    th, tw = tex.shape
    ys = np.arange(height) % th
    xs = np.arange(width) % tw
    return tex[ys][:, xs]


def quantize(colors: np.ndarray, levels: int, mode: DitherMode,
             size: int = 128, seed: int = 1337) -> np.ndarray:
    """Quantize (..., C) float colors in [0, 1] to `levels` steps.

    A single screen-space threshold perturbs all channels of a pixel
    (luminance dithering), which keeps the error spectrally clean.
    """
    if levels < 2:
        raise ValueError("levels must be >= 2")
    h, w = colors.shape[:2]
    field = dither_field(mode, h, w, size, seed)
    steps = levels - 1
    offset = (field - 0.5)[..., None]
    q = np.floor(colors * steps + 0.5 + offset) / steps
    return np.clip(q, 0.0, 1.0)
