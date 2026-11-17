"""Additional property checks beyond the main demo report.

1. Temporal stability: grain sampled in fixed screen coordinates across frames
    must be strongly correlated; fully re-randomised white noise is not.
 2. Screen-locked grain under a moving image: the grain field at a fixed pixel
    follows the screen, not the moving scene content.
 3. No periodicity: correlation between far-apart screen regions stays ~0, and
    shifting coordinates by arbitrary large offsets produces independent noise
    (a tiled generator would show repeat structure).
"""

from __future__ import annotations

import numpy as np

from grain_pipeline.grain import GrainParams, apply_grain
from grain_pipeline.noise import value_noise_3d, white_noise_2d
from grain_pipeline.scene import dynamic_scene
from grain_pipeline.tonemap import tone_map


def temporal_comparison() -> dict:
    rng = np.random.default_rng(0)
    base = rng.uniform(0.05, 0.9, size=(128, 128, 3)).astype(np.float32)
    params = GrainParams(strength=0.1, scale=1.6, temporal_rate=0.18)

    film_deltas, white_deltas = [], []
    for f in range(8):
        _, d = apply_grain(base, f, params)
        film_deltas.append(d[..., 1])
        gy, gx = np.mgrid[0:128, 0:128]
        white_deltas.append(white_noise_2d(gx, gy, float(f)))

    def lag1(seq):
        a, b = seq[:-1], seq[1:]
        return float(np.mean([np.mean(x * y) / (np.std(x) * np.std(y))
                              for x, y in zip(a, b)]))

    return {
        "film_grain_lag1_corr": lag1(film_deltas),
        "white_noise_lag1_corr": lag1(white_deltas),
    }


def screen_locked_under_motion() -> dict:
    """Same screen pixel, moving content: grain itself must stay anchored."""
    params = GrainParams(strength=0.12, scale=2.0, temporal_rate=0.18)
    deltas = []
    for f in range(10):
        clean = tone_map(dynamic_scene(160, 240, f, 10))
        _, d = apply_grain(clean, f, params)
        deltas.append(d[80, 120, 1])  # fixed screen pixel
    deltas = np.array(deltas)
    return {
        "fixed_pixel_grain_range": float(deltas.max() - deltas.min()),
        "fixed_pixel_grain_std": float(np.std(deltas)),
        "fixed_pixel_signed_values": np.round(deltas, 4).tolist(),
    }


def periodicity_check() -> dict:
    gy, gx = np.mgrid[0:256, 0:256]
    n0 = value_noise_3d(gx, gy, 0.0, 1.8, seed=7)

    # Compare against patches at large, arbitrary (non-power-of-two) offsets.
    corrs = []
    for shift in (333, 1027, 4099, 12347):
        ns = value_noise_3d(gx + shift, gy + shift, 0.0, 1.8, seed=7)
        corrs.append(float(np.mean(n0 * ns) / (np.std(n0) * np.std(ns))))

    # Adjacent-region correlation should be smooth/high; far regions ~0.
    n_shift1 = value_noise_3d(gx + 1, gy, 0.0, 1.8, seed=7)
    adjacent = float(np.mean(n0 * n_shift1) / (np.std(n0) * np.std(n_shift1)))
    return {
        "far_offset_corrs": [round(c, 4) for c in corrs],
        "far_offset_corr_max_abs": float(max(abs(c) for c in corrs)),
        "adjacent_pixel_corr": adjacent,
    }


if __name__ == "__main__":
    out = {
        "temporal": temporal_comparison(),
        "screen_locked": screen_locked_under_motion(),
        "periodicity": periodicity_check(),
    }
    import json
    print(json.dumps(out, indent=2))
