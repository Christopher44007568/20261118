"""Fast property tests, runnable directly: .venv/bin/python tests/test_properties.py"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from grain_pipeline.grain import GrainParams, apply_grain, grain_weight
from grain_pipeline.noise import value_noise_3d


def test_black_never_lifts():
    img = np.zeros((32, 32, 3), dtype=np.float32)
    img[8:24, 8:24] = 0.5
    out, delta = apply_grain(img, 0, GrainParams(strength=0.2, scale=1.4))
    assert np.count_nonzero(out[:8, :, :]) == 0
    assert np.abs(delta).sum() > 0  # grain exists elsewhere


def test_off_mode_is_identity():
    img = np.random.default_rng(1).random((24, 24, 3)).astype(np.float32)
    out, delta = apply_grain(img, 3, GrainParams(strength=0.0))
    assert np.array_equal(out, img) and np.count_nonzero(delta) == 0


def test_shadow_grain_exceeds_highlight():
    luma = np.array([0.0, 0.02, 0.1, 0.5, 0.95], dtype=np.float32)
    w = grain_weight(luma, shadow_gain=2.2, highlight_gain=0.6)
    assert w[0] == 0.0  # exact black
    dark = grain_weight(np.linspace(0.02, 0.2, 32, dtype=np.float32), 2.2, 0.6)
    bright = grain_weight(np.linspace(0.8, 0.98, 32, dtype=np.float32), 2.2, 0.6)
    assert dark.mean() > bright.mean()
    assert w[4] < 0.8  # highlight amplitude stays close to highlightGain


def test_noise_is_aperiodic_and_centered():
    gy, gx = np.mgrid[0:128, 0:128]
    n = value_noise_3d(gx, gy, 0.0, 1.7, seed=99)
    assert abs(float(n.mean())) < 0.05
    shifted = value_noise_3d(gx + 5011, gy + 5011, 0.0, 1.7, seed=99)
    corr = float(np.mean(n * shifted) / (np.std(n) * np.std(shifted)))
    assert abs(corr) < 0.1


def test_scale_changes_flake_size():
    gy, gx = np.mgrid[0:128, 0:128]
    fine = value_noise_3d(gx, gy, 0.0, 1.0, seed=5)
    coarse = value_noise_3d(gx, gy, 0.0, 4.0, seed=5)
    # Coarser lattice -> stronger correlation between neighbouring pixels.
    def neighbour_corr(a):
        return float(np.corrcoef(a[:, :-1].ravel(), a[:, 1:].ravel())[0, 1])
    assert neighbour_corr(coarse) > neighbour_corr(fine)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("all property tests passed")
