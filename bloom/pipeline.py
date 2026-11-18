"""HDR Bloom pipeline built from NumPy primitives.

Stages
------
1. Brightness extraction with a threshold and a controllable soft knee.
2. Progressive downsampling into a mip pyramid (area average + blur).
3. Progressive upsampling with per-layer weights (additive mip chain).
4. Composite of the bloom texture onto the (HDR) source image.

All image arrays are float32, shape ``(H, W, 3)`` and may hold values
above 1.0 (HDR).  Nothing is tone mapped inside the pipeline so that the
true peak values remain measurable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math

import numpy as np


# ---------------------------------------------------------------------------
# Low level filters
# ---------------------------------------------------------------------------


def _reflect_pad(arr: np.ndarray, pad: int) -> np.ndarray:
    """Reflect padding that never samples outside the mirrored domain."""
    if pad <= 0:
        return arr
    return np.pad(arr, ((pad, pad), (pad, pad), (0, 0)), mode="reflect")


def box_blur(image: np.ndarray, radius: int) -> np.ndarray:
    """Separable box blur with an integer pixel ``radius`` (edge reflect)."""
    radius = int(max(0, radius))
    if radius == 0:
        return image.astype(np.float32, copy=True)
    k = 2 * radius + 1

    def uniform_filter1d(src: np.ndarray, axis: int) -> np.ndarray:
        pad_width = [(0, 0)] * src.ndim
        pad_width[axis] = (radius, radius)
        padded = np.pad(src, pad_width, mode="reflect")
        out = np.zeros_like(src)
        length = src.shape[axis]
        for offset in range(k):
            sl = [slice(None)] * src.ndim
            sl[axis] = slice(offset, offset + length)
            out += padded[tuple(sl)]
        return (out / k).astype(np.float32)

    horizontal = uniform_filter1d(image, axis=1)
    return uniform_filter1d(horizontal, axis=0)


def gaussian_blur(image: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur; sigma is in source pixels."""
    sigma = float(max(sigma, 1e-6))
    half = max(1, int(round(3.0 * sigma)))
    x = np.arange(-half, half + 1, dtype=np.float32)
    kernel = np.exp(-(x * x) / (2.0 * sigma * sigma))
    kernel /= kernel.sum()
    def convolve1d(src: np.ndarray, ker: np.ndarray, axis: int) -> np.ndarray:
        pad_width = [(0, 0)] * src.ndim
        pad_width[axis] = (half, half)
        padded = np.pad(src, pad_width, mode="reflect")
        out = np.zeros_like(src)
        for i, weight in enumerate(ker):
            sl = [slice(None)] * src.ndim
            sl[axis] = slice(i, i + src.shape[axis])
            out += weight * padded[tuple(sl)]
        return out

    blurred = convolve1d(image, kernel, axis=1)
    blurred = convolve1d(blurred, kernel, axis=0)
    return blurred.astype(np.float32)


# ---------------------------------------------------------------------------
# Brightness extraction (threshold + soft knee)
# ---------------------------------------------------------------------------


def luminance(image: np.ndarray) -> np.ndarray:
    """Rec. 709 relative luminance, returned with shape ``(H, W, 1)``."""
    weights = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return np.maximum(image @ weights, 0.0).astype(np.float32)[..., None]


def soft_knee_gain(luma: np.ndarray, threshold: float, soft_knee: float) -> np.ndarray:
    """Per-pixel contribution gain in ``[0, 1]``.

    * ``luma <= threshold``                -> 0
    * the ``soft_knee`` band above the
      threshold                            -> smooth quadratic ramp
    * ``luma >= threshold + soft_knee``    -> 1 (full contribution)

    A soft knee of 0 gives a hard threshold.  The quadratic ramp has a
    zero derivative at both ends, so the extracted mask joins smoothly
    and halos fade instead of showing a visible cutoff ring.
    """
    threshold = float(threshold)
    soft_knee = float(max(soft_knee, 0.0))
    lum = luma[..., 0]
    if soft_knee <= 1e-8:
        return (lum > threshold).astype(np.float32)[..., None]
    x = np.clip((lum - threshold) / soft_knee, 0.0, 1.0)
    gain = x * x * (3.0 - 2.0 * x)  # smoothstep
    return gain.astype(np.float32)[..., None]


def brightness_extract(
    image: np.ndarray, threshold: float, soft_knee: float
) -> np.ndarray:
    """Thresholded HDR contribution used as the root of the bloom pyramid."""
    luma = luminance(image)
    gain = soft_knee_gain(luma, threshold, soft_knee)
    # Weighted colour keeps the tint of each emitter instead of flattening
    # everything to white, which also prevents whole-frame wash-out.
    return (image.astype(np.float32) * gain).astype(np.float32)


# ---------------------------------------------------------------------------
# Progressive downsampling / upsampling
# ---------------------------------------------------------------------------


def downsample(image: np.ndarray, blur_radius: int = 1) -> np.ndarray:
    """2x downsample: reflect-safe box blur followed by even-index decimation.

    The pre-blur removes high frequencies so halos stay smooth at every
    mip level instead of aliasing into blocky edges.
    """
    blurred = box_blur(image, blur_radius)
    return blurred[::2, ::2, :].astype(np.float32)


def _bilinear_resize(image: np.ndarray, out_h: int, out_w: int) -> np.ndarray:
    """Bilinear resize that always includes both source corner samples."""
    h, w = image.shape[:2]
    if h == out_h and w == out_w:
        return image.astype(np.float32, copy=True)
    row = np.linspace(0.0, h - 1, out_h, dtype=np.float32)
    col = np.linspace(0.0, w - 1, out_w, dtype=np.float32)
    r0 = np.floor(row).astype(np.int64)
    c0 = np.floor(col).astype(np.int64)
    r1 = np.minimum(r0 + 1, h - 1)
    c1 = np.minimum(c0 + 1, w - 1)
    wr = (row - r0).astype(np.float32)[:, None]
    wc = (col - c0).astype(np.float32)[None, :]
    top = image[r0[:, None], c0[None, :], :] * (1 - wc[..., None]) \
        + image[r0[:, None], c1[None, :], :] * wc[..., None]
    bottom = image[r1[:, None], c0[None, :], :] * (1 - wc[..., None]) \
        + image[r1[:, None], c1[None, :], :] * wc[..., None]
    return (top * (1 - wr[..., None]) + bottom * wr[..., None]).astype(np.float32)


def upsample(image: np.ndarray, target_shape: tuple[int, int], sigma: float = 1.0) -> np.ndarray:
    """2x-ish upsample back to ``target_shape`` plus a Gaussian smoothing."""
    out_h, out_w = target_shape
    resized = _bilinear_resize(image, out_h, out_w)
    return gaussian_blur(resized, sigma)


# ---------------------------------------------------------------------------
# Configuration and pyramid orchestration
# ---------------------------------------------------------------------------


@dataclass
class BloomConfig:
    """User-tunable Bloom parameters.

    threshold
        Luminance (HDR scale) above which a pixel contributes.
    soft_knee
        Width of the smooth transition band above ``threshold``.
    radius
        Global spread control in ``[0.1, 3.0]``.  It scales both the
        downsample blur and the upsampling Gaussian, and the relative
        weight handed to the coarser mip levels.
    level_weights
        Per-level additive weights.  Index 0 is the brightest, tightest
        mip; later indices are progressively wider and softer.  Missing
        entries fall back to equal weights.
    intensity
        Master multiplier applied to the combined bloom texture.
    levels
        Number of downsample stages (excluding the extracted root).
    """

    threshold: float = 1.0
    soft_knee: float = 0.5
    radius: float = 1.0
    level_weights: tuple[float, ...] = (0.35, 0.28, 0.20, 0.12, 0.05)
    intensity: float = 1.0
    levels: int = 5

    def normalized_weights(self) -> np.ndarray:
        """Weights padded/truncated to ``levels`` entries and normalized."""
        weights = np.asarray(self.level_weights, dtype=np.float32)
        if weights.size < self.levels:
            pad = np.full(self.levels - weights.size, weights[-1] if weights.size else 1.0)
            weights = np.concatenate([weights, pad])
        weights = weights[: self.levels]
        total = float(weights.sum())
        if total > 1e-8:
            weights = weights / total
        return weights


def build_pyramid(image: np.ndarray, config: BloomConfig) -> list[np.ndarray]:
    """Return ``[root, mip1, ..., mipN]`` from brightness extraction.

    Each stage halves resolution.  The blur radius grows slightly on the
    coarser mips (scaled by ``config.radius``) so wide halos are built
    from low-frequency levels rather than by blurring the full image.
    """
    root = brightness_extract(image, config.threshold, config.soft_knee)
    pyramid = [root]
    current = root
    base_blur = max(1, int(round(config.radius)))
    for level in range(config.levels):
        if current.shape[0] < 4 or current.shape[1] < 4:
            break
        blur_radius = base_blur + (1 if level >= 2 and config.radius > 0.5 else 0)
        current = downsample(current, blur_radius=blur_radius)
        pyramid.append(current)
    return pyramid


def combine_pyramid(
    pyramid: list[np.ndarray], config: BloomConfig
) -> tuple[np.ndarray, list[np.ndarray]]:
    """Additive mip chain with progressive (one stage at a time) upsampling.

    Each coarse level is enlarged only to the next level's resolution,
    blurred, accumulated, then enlarged again - the classic scattering
    bloom construction.  Walking the chain instead of jumping straight
    from an 8x8 mip to full resolution removes blocky low-mip artifacts
    so the glow falls off smoothly around bright edges.

    Returns the combined bloom texture and the per-level full-resolution
    contributions (kept for per-level texture previews).
    """
    root_h, root_w = pyramid[0].shape[:2]
    weights = config.normalized_weights()
    # Radius shifts emphasis toward the broad, soft mips.
    radius_scale = float(np.clip(config.radius, 0.1, 3.0))
    contributions: list[np.ndarray] = []
    last = len(pyramid) - 1
    accumulator = pyramid[last] * weights[last - 1]
    # Scatter-style chain: carry the coarse glow upward one mip at a time,
    # injecting each level's own (weighted) contribution at its native
    # resolution.  No level ever jumps directly to full resolution, which
    # is what keeps coarse, broad halos free of blocky mip artifacts.
    for level in range(last - 1, 0, -1):
        target = pyramid[level]
        sigma = 0.8 * radius_scale * (1.0 + 0.15 * (level - 1))
        grown = upsample(accumulator, target.shape[:2], sigma=sigma)
        accumulator = grown + pyramid[level] * weights[level - 1]
    full_res = upsample(accumulator, (root_h, root_w), sigma=0.9 * radius_scale)
    # Per-level full-resolution contributions are kept for the preview sheet.
    for level in range(1, len(pyramid)):
        sigma = 0.8 * radius_scale * (1.0 + 0.35 * (level - 1))
        upsampled = upsample(pyramid[level], (root_h, root_w), sigma=sigma)
        weighted = upsampled * (weights[level - 1] * config.intensity)
        contributions.append(weighted.astype(np.float32))
    # The chain result drives the actual bloom; preview layers stay additive.
    combined = (full_res * config.intensity).astype(np.float32)
    return combined.astype(np.float32), contributions


def apply_bloom(
    image: np.ndarray, config: BloomConfig
) -> dict[str, np.ndarray | list[np.ndarray]]:
    """Run the full pipeline and return every intermediate texture.

    The composite is a simple additive blend in linear HDR space; no
    tone mapping is applied so peak-luminance measurements stay exact.
    """
    source = image.astype(np.float32, copy=True)
    pyramid = build_pyramid(source, config)
    bloom, contributions = combine_pyramid(pyramid, config)
    composite = np.maximum(source + bloom, 0.0).astype(np.float32)
    return {
        "source": source,
        "extracted": pyramid[0],
        "pyramid": pyramid,
        "contributions": contributions,
        "bloom": bloom,
        "composite": composite,
    }
