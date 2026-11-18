"""Quantitative measurements used in the Bloom report."""

from __future__ import annotations

import numpy as np


def peak_luminance(image: np.ndarray) -> float:
    weights = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return float(np.max(image @ weights))


def mean_luminance(image: np.ndarray) -> float:
    weights = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return float(np.mean(image @ weights))


def bloom_footprint(bloom: np.ndarray, fraction: float = 0.01) -> float:
    """Fraction of pixels whose bloom contribution is non-negligible."""
    energy = np.max(bloom, axis=2)
    if float(energy.max()) <= 0.0:
        return 0.0
    return float(np.mean(energy > fraction * energy.max()))


def halo_decay_profile(
    bloom: np.ndarray, center: tuple[float, float], max_radius: int
) -> list[tuple[int, float]]:
    """Mean bloom energy in concentric rings around an emitter (smoothness)."""
    h, w = bloom.shape[:2]
    cy, cx = center
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    radius = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    energy = bloom.max(axis=2)
    profile: list[tuple[int, float]] = []
    for ring in range(0, int(max_radius), 4):
        mask = (radius >= ring) & (radius < ring + 4)
        value = float(energy[mask].mean()) if mask.any() else 0.0
        profile.append((ring, value))
    return profile


def whiteness_ratio(image: np.ndarray) -> float:
    """Fraction of tone-mapped pixels approaching neutral white (>0.9).

    A healthy bloom raises this only locally; a broken bloom that floods
    the whole frame drives it toward 1.0.
    """
    mapped = image / (1.0 + image)
    grey = mapped.min(axis=2)
    return float(np.mean(grey > 0.9))


def summarize(source: np.ndarray, composite: np.ndarray, bloom: np.ndarray) -> dict:
    off_peak = peak_luminance(source)
    on_peak = peak_luminance(composite)
    return {
        "peak_off": off_peak,
        "peak_on": on_peak,
        "peak_delta": on_peak - off_peak,
        "peak_ratio": (on_peak / off_peak) if off_peak > 1e-9 else float("inf"),
        "mean_off": mean_luminance(source),
        "mean_on": mean_luminance(composite),
        "bloom_footprint": bloom_footprint(bloom),
        "white_off": whiteness_ratio(source),
        "white_on": whiteness_ratio(composite),
    }
