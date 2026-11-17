"""Film grain applied after tone mapping.

Design properties requested by the task:

* Strength and scale (flake size) are adjustable parameters.
* The grain lives in a 3-D noise field (screen x, screen y, time), so it stays
  stable on screen and evolves smoothly instead of being re-randomised every
  frame.
* Shadow grain and highlight grain have different amplitudes: shadows carry
  noticeably more grain, highlights less.
* Pure black never lifts: the weight ramps to exactly 0 at luma 0, the noise is
  zero-mean, and an explicit guard forces the grain contribution to 0 on black
  pixels.  There is no DC offset anywhere.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .noise import value_noise_3d


@dataclass(frozen=True)
class GrainParams:
    """Film-grain configuration.

    strength      overall grain amplitude as a fraction of the display range
                  (e.g. 0.0 = off, 0.06 ~ light, 0.18 ~ heavy).
    scale         grain flake size in screen pixels (small = fine grain).
    shadow_gain   multiplier applied to dark regions (luma -> 0).
    highlight_gain multiplier applied to bright regions (luma -> 1).
    temporal_rate how fast the field evolves per frame (0 = frozen grain,
                  small values = stable slowly-changing grain).
    chroma        per-channel decorrelation amount in [0, 1].
    """

    strength: float = 0.06
    scale: float = 1.6
    shadow_gain: float = 2.2
    highlight_gain: float = 0.6
    temporal_rate: float = 0.18
    chroma: float = 0.35
    seed: int = 1337


def _srgb_luma(img01: np.ndarray) -> np.ndarray:
    w = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return np.tensordot(img01, w, axes=(-1, 0)).astype(np.float32)


def grain_weight(luma: np.ndarray,
                 shadow_gain: float, highlight_gain: float) -> np.ndarray:
    """Per-pixel amplitude mask.

    Smooth ramp that equals ``shadow_gain`` toward black and ``highlight_gain``
    toward white, while being *exactly* zero at luma == 0 so pure black can
    never be lifted.
    """
    t = np.clip(luma, 0.0, 1.0)
    # Strong amplitude right out of black (ramp ~ sqrt keeps shadow grain
    # clearly visible), decaying toward a small but non-zero highlight level.
    ramp = (
        highlight_gain
        + (shadow_gain - highlight_gain) * np.sqrt(np.maximum(t, 0.0))
        * (1.0 - t)
    )
    return np.where(luma > 0.0, ramp, 0.0).astype(np.float32)


def apply_grain(img01: np.ndarray, frame_index: int,
                params: GrainParams) -> tuple[np.ndarray, np.ndarray]:
    """Add post-tonemap grain to an sRGB float image in [0, 1].

    Returns (grained_image, signed_grain_delta) where the delta has no DC
    offset and is exactly 0 on black pixels.
    """
    if params.strength <= 0.0:
        zero = np.zeros_like(img01)
        return img01.copy(), zero

    h, w, _ = img01.shape
    gx, gy = np.meshgrid(
        np.arange(w, dtype=np.int32),
        np.arange(h, dtype=np.int32),
    )
    t = frame_index * params.temporal_rate

    luma = _srgb_luma(img01)
    mask = grain_weight(luma, params.shadow_gain, params.highlight_gain)

    n_lum = value_noise_3d(gx, gy, t, params.scale, params.seed)
    deltas = np.empty_like(img01)
    for c in range(3):
        if c == 0 or params.chroma <= 0.0:
            n = n_lum
        else:
            n_chr = value_noise_3d(gx, gy, t, params.scale,
                                   params.seed + 101 * c)
            n = ((1.0 - params.chroma) * n_lum
                 + params.chroma * n_chr).astype(np.float32)
        deltas[..., c] = (
            np.float32(params.strength) * mask * n
        )

    # Hard guard: no contribution where the source image is pure black.
    black = (luma <= 0.0)[..., None]
    deltas = np.where(black, 0.0, deltas).astype(np.float32)

    out = np.clip(img01 + deltas, 0.0, 1.0).astype(np.float32)
    return out, deltas
