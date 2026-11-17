"""Procedural HDR-linear test scenes.

Both scenes contain a true black border strip (radiance 0.0) so black-lift
behaviour can be measured directly.
"""

from __future__ import annotations

import numpy as np


BLACK_BORDER = 8


def _coord_grids(h: int, w: int):
    yy, xx = np.meshgrid(
        np.arange(h, dtype=np.float32),
        np.arange(w, dtype=np.float32),
        indexing="ij",
    )
    return xx, yy


def static_scene(h: int, w: int, frame_index: int) -> np.ndarray:
    """Static scene with dark, mid and HDR-bright zones plus a sweep ramp."""
    xx, yy = _coord_grids(h, w)

    # Horizontal luminance zones (linear radiance, HDR range).
    zone = np.zeros((h, w), dtype=np.float32)
    edges = [0, int(w * 0.25), int(w * 0.5), int(w * 0.75), w]
    levels = [0.0, 0.05, 0.35, 2.5]
    for lo, hi, lv in zip(edges[:-1], edges[1:], levels):
        zone[:, lo:hi] = lv

    # Diagonal moving-ish stripes in the mid zone to add high-frequency detail.
    stripes = (((xx + yy) // 18) % 2).astype(np.float32)
    zone += stripes * 0.12

    # Soft HDR blob whose brightness varies slightly between sequence frames.
    cx, cy = w * 0.62, h * (0.35 + 0.02 * frame_index)
    r2 = ((xx - cx) / (w * 0.12)) ** 2 + ((yy - cy) / (h * 0.22)) ** 2
    blob = np.exp(-r2) * (4.0 + 0.6 * frame_index)
    radiance = zone + blob

    img = np.repeat(radiance[..., None], 3, axis=-1)
    # Slight per-channel tint so the image is genuinely RGB.
    img[..., 1] *= 0.92
    img[..., 2] *= 1.05
    return _apply_black_border(img)


def dynamic_scene(h: int, w: int, frame_index: int,
                  frame_count: int) -> np.ndarray:
    """Moving-camera style shot: a bright sphere and bars translate each frame.

    The scene content moves in screen space while grain is sampled in screen
    space, so the grain remains stable on screen while the picture moves.
    """
    xx, yy = _coord_grids(h, w)
    phase = frame_index / max(frame_count - 1, 1)

    # Dark, slightly varying background (linear radiance).
    vign = 0.025 + 0.04 * (xx / w)
    radiance = vign.astype(np.float32)

    # Translating parallax bars.
    shift = phase * w * 0.6
    bars = (np.floor((xx + shift) / 46.0) % 2).astype(np.float32)
    radiance += bars * 0.10

    # Moving HDR sphere, entering from the left and exiting on the right.
    cx = w * (0.15 + 0.7 * phase)
    cy = h * (0.45 + 0.08 * np.sin(phase * np.pi))
    rad = min(h, w) * 0.16
    r2 = (xx - cx) ** 2 + (yy - cy) ** 2
    sphere = np.maximum(0.0, 1.0 - r2 / (rad * rad)) ** 2
    radiance += sphere * 5.0

    img = np.repeat(radiance[..., None], 3, axis=-1)
    img[..., 0] *= 1.08
    img[..., 2] *= 0.9
    return _apply_black_border(img)


def _apply_black_border(img: np.ndarray) -> np.ndarray:
    b = BLACK_BORDER
    img[:b, :, :] = 0.0
    img[-b:, :, :] = 0.0
    img[:, :b, :] = 0.0
    img[:, -b:, :] = 0.0
    return img
