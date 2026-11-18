"""Spectral and spatial uniformity analysis for noise and error fields."""

from __future__ import annotations

import numpy as np


def radially_averaged_power_spectrum(field: np.ndarray):
    """Return (normalized radii, power) for a 2D field.

    Radii are normalized so 1.0 == Nyquist. The field is mean-centered
    and Hann-windowed to reduce boundary leakage.
    """
    f = np.asarray(field, dtype=np.float64)
    f = f - f.mean()
    h, w = f.shape
    win = np.hanning(h)[:, None] * np.hanning(w)[None, :]
    power = np.abs(np.fft.fftshift(np.fft.fft2(f * win))) ** 2
    yy, xx = np.mgrid[0:h, 0:w]
    radius = np.hypot((yy - h // 2) / (h / 2), (xx - w // 2) / (w / 2))
    bins = np.linspace(0, np.sqrt(2), 65)
    centers = 0.5 * (bins[:-1] + bins[1:])
    out = np.zeros_like(centers)
    idx = np.digitize(radius.ravel(), bins) - 1
    flat = power.ravel()
    for i in range(len(centers)):
        m = idx == i
        if m.any():
            out[i] = flat[m].mean()
    return centers, out


def low_frequency_energy_ratio(field: np.ndarray, cutoff: float = 0.15) -> float:
    """Fraction of spectral power below `cutoff` (Nyquist=1).

    Blue noise should be far below white noise here; low values mean
    no visible blotches, bands, or slow undulations.
    """
    centers, power = radially_averaged_power_spectrum(field)
    total = power.sum()
    if total <= 0:
        return 0.0
    return float(power[centers < cutoff].sum() / total)


def anisotropy(field: np.ndarray) -> float:
    """0 = isotropic; larger = directional bias (streaks)."""
    f = np.asarray(field, dtype=np.float64)
    f = f - f.mean()
    power = np.abs(np.fft.fftshift(np.fft.fft2(f))) ** 2
    h, w = f.shape
    yy, xx = np.mgrid[0:h, 0:w]
    ang = np.arctan2(yy - h // 2, xx - w // 2)
    radius = np.hypot((yy - h // 2) / (h / 2), (xx - w // 2) / (w / 2))
    ring = (radius > 0.3) & (radius < 0.9)
    p = power[ring]
    a = ang[ring]
    c2 = (p * np.cos(2 * a)).sum()
    s2 = (p * np.sin(2 * a)).sum()
    return float(np.hypot(c2, s2) / max(p.sum(), 1e-12))


def neighborhood_uniformity(field: np.ndarray, window: int = 16) -> dict:
    """Local-mean statistics over non-overlapping windows.

    For a well-distributed error field the local means cluster near
    zero; a large spread means visible blotches at the window scale.
    """
    f = np.asarray(field, dtype=np.float64)
    f = f - f.mean()
    h, w = f.shape
    window = max(1, min(window, h, w))
    h -= h % window
    w -= w % window
    blocks = f[:h, :w].reshape(h // window, window, w // window, window)
    local_means = blocks.mean(axis=(1, 3))
    return {
        "window": window,
        "local_mean_std": float(local_means.std()),
        "local_mean_absmax": float(np.abs(local_means).max()),
    }


def repeat_block_score(field: np.ndarray, max_period: int = 64) -> float:
    """Strongest normalized autocorrelation at periods 2..max_period.

    High values indicate tiling/checkerboard repetition (Bayer scores
    high; blue and white noise stay near zero).
    """
    f = np.asarray(field, dtype=np.float64).ravel()
    f = f - f.mean()
    var = float((f * f).sum())
    if var <= 0:
        return 0.0
    best = 0.0
    for p in range(2, max_period + 1):
        c = float((f[:-p] * f[p:]).sum()) / var
        best = max(best, c)
    return best
