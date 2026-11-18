"""Test scenes rendered in float RGB, with a camera offset parameter.

The camera offset translates the *scene content* only. Dithering is
always applied afterwards in screen space, so the noise pattern is
locked to the display while the world slides underneath it.
"""

from __future__ import annotations

import numpy as np

from .dither import DitherMode, quantize


def scene_gradient(width: int, height: int, dx: float = 0.0,
                   dy: float = 0.0) -> np.ndarray:
    """Multi-step grayscale gradient: smooth ramp plus gentle wave."""
    x = (np.arange(width) - dx) / max(width - 1, 1)
    y = (np.arange(height) - dy) / max(height - 1, 1)
    ramp = x[None, :] * 0.85 + 0.05
    wave = 0.06 * np.sin(y[:, None] * 4 * np.pi) * x[None, :]
    g = np.clip(ramp + wave, 0.0, 1.0)
    return np.repeat(g[..., None], 3, axis=2)


def scene_dark(width: int, height: int, dx: float = 0.0,
               dy: float = 0.0) -> np.ndarray:
    """Very dark ramp (0..8%): the worst case for banding."""
    x = (np.arange(width) - dx) / max(width - 1, 1)
    y = (np.arange(height) - dy) / max(height - 1, 1)
    g = np.clip(0.08 * x[None, :] + 0.012 * np.sin(y[:, None] * 2 * np.pi),
                0.0, 1.0)
    return np.repeat(g[..., None], 3, axis=2)


def _background(width: int, height: int, dx: float, dy: float) -> np.ndarray:
    x = (np.arange(width) - dx) / max(width - 1, 1)
    y = (np.arange(height) - dy) / max(height - 1, 1)
    xx, yy = np.meshgrid(x, y)
    bg = np.stack([
        0.55 + 0.35 * np.sin(xx * 6 * np.pi),
        0.45 + 0.30 * np.cos(yy * 5 * np.pi),
        0.60 - 0.30 * np.sin((xx + yy) * 3 * np.pi),
    ], axis=-1)
    blob = np.exp(-(((xx - 0.5) ** 2 + (yy - 0.55) ** 2) / 0.02))
    bg = bg * (1 - blob[..., None]) + np.array([0.9, 0.85, 0.7]) * blob[..., None]
    return np.clip(bg, 0.0, 1.0)


def scene_fog(width: int, height: int, dx: float = 0.0, dy: float = 0.0,
              fog_color=(0.62, 0.68, 0.75), fog_levels: int = 24,
              mode: DitherMode = DitherMode.NONE,
              quantize_before_blend: bool = True,
              seed: int = 1337) -> np.ndarray:
    """Semi-transparent fog over a background.

    Correct pipeline (quantize_before_blend=True): the fog layer color
    is dithered + quantized *before* alpha blending, so the blend
    cannot re-introduce smooth gradients that then band. The alpha
    itself varies smoothly across the frame.
    """
    bg = _background(width, height, dx, dy)
    x = (np.arange(width) - dx) / max(width - 1, 1)
    alpha = np.clip(0.15 + 0.55 * x[None, :], 0.0, 1.0)
    alpha = np.repeat(alpha, height, axis=0)[..., None]

    # Fog color itself varies smoothly (e.g. sky-lit fog), so quantizing
    # the layer before blending is a real banding risk, not a no-op.
    y = (np.arange(height) - dy) / max(height - 1, 1)
    tint = 0.10 * np.sin(x[None, :] * 2 * np.pi) + \
           0.06 * np.cos(y[:, None] * 2 * np.pi)
    fog = np.empty((height, width, 3))
    fog[:] = np.asarray(fog_color, dtype=np.float64)
    fog += tint[..., None] * np.array([1.0, 0.6, -0.8])
    fog = np.clip(fog, 0.0, 1.0)
    if quantize_before_blend:
        fog = quantize(fog, fog_levels, mode, seed=seed)
        out = bg * (1 - alpha) + fog * alpha
    else:
        out = bg * (1 - alpha) + fog * alpha
        out = quantize(out, fog_levels, mode, seed=seed)
    return np.clip(out, 0.0, 1.0)


def apply_dither(scene: np.ndarray, levels: int, mode: DitherMode,
                 seed: int = 1337) -> np.ndarray:
    return quantize(scene, levels, mode, seed=seed)
