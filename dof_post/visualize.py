"""Visualisation helpers: depth map, CoC map, tonemapped colour, panels."""

from __future__ import annotations

import numpy as np
from PIL import Image

from .coc import LensSettings


def tonemap(color: np.ndarray, exposure: float = 1.0) -> np.ndarray:
    """Reinhard tonemap + gamma, linear HDR -> uint8 sRGB."""
    c = np.clip(color * exposure, 0.0, None)
    c = c / (1.0 + c)
    c = np.power(c, 1.0 / 2.2)
    return (np.clip(c, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def depth_image(depth: np.ndarray, near: float = 1.0,
                far: float = 40.0) -> np.ndarray:
    """Greyscale depth visualisation (near = bright, far = dark)."""
    t = np.clip((np.log(depth) - np.log(near)) / (np.log(far) - np.log(near)),
                0.0, 1.0)
    g = (1.0 - t) * 255.0
    return np.stack([g, g, g], axis=-1).astype(np.uint8)


def coc_image(signed: np.ndarray, lens: LensSettings) -> np.ndarray:
    """Signed CoC visualisation: red = foreground, blue = background."""
    near = np.clip(-signed / max(lens.max_coc_near, 1e-6), 0.0, 1.0)
    far = np.clip(signed / max(lens.max_coc_far, 1e-6), 0.0, 1.0)
    img = np.zeros((*signed.shape, 3), dtype=np.float32)
    img[..., 0] = near
    img[..., 2] = far
    img[..., 1] = 0.25 * np.maximum(near, far)
    return (img * 255.0 + 0.5).astype(np.uint8)


def save_image(arr: np.ndarray, path: str) -> None:
    Image.fromarray(arr).save(path)


def triptych(depth_u8: np.ndarray, coc_u8: np.ndarray,
             color_u8: np.ndarray, pad: int = 4) -> np.ndarray:
    """Stack the three visualisations side by side with labels."""
    from PIL import ImageDraw

    h, w = depth_u8.shape[:2]
    panel = np.full((h + 22, 3 * w + 4 * pad, 3), 24, dtype=np.uint8)
    for i, img in enumerate((depth_u8, coc_u8, color_u8)):
        panel[22:, pad + i * (w + pad):pad + i * (w + pad) + w] = img
    out = Image.fromarray(panel)
    draw = ImageDraw.Draw(out)
    for i, label in enumerate(("depth", "coc radius (R=near B=far)", "color")):
        draw.text((pad + i * (w + pad) + 4, 5), label, fill=(230, 230, 230))
    return np.asarray(out)
