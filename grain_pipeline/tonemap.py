"""Tone mapping pipeline.

Film grain is added *after* tone mapping (post ACES, on the display-referred
image), matching the requirement that grain live in the final image domain.
"""

from __future__ import annotations

import numpy as np


def aces_approx(hdr: np.ndarray) -> np.ndarray:
    """Narkowicz ACES filmic approximation on linear HDR RGB data."""
    x = np.maximum(hdr, np.float32(0.0))
    a = x * (np.float32(2.51) * x + np.float32(0.03))
    b = x * (np.float32(2.43) * x + np.float32(0.59)) + np.float32(0.14)
    return np.clip(a / b, 0.0, 1.0).astype(np.float32)


def linear_to_srgb(x: np.ndarray) -> np.ndarray:
    """Linear-light -> sRGB transfer function, output in [0, 1]."""
    x = np.clip(x, 0.0, 1.0)
    lo = np.float32(12.92) * x
    hi = np.float32(1.055) * np.power(x, np.float32(1.0 / 2.4)) - np.float32(0.055)
    return np.where(x <= np.float32(0.0031308), lo, hi).astype(np.float32)


def tone_map(hdr_linear: np.ndarray) -> np.ndarray:
    """Full HDR-linear -> display sRGB (still float in [0, 1])."""
    return linear_to_srgb(aces_approx(hdr_linear))


def to_uint8(img01: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(img01 * 255.0), 0, 255).astype(np.uint8)
