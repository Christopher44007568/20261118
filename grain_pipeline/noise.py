"""Tiling-free procedural noise used as the film-grain source.

The noise is defined over an *infinite* integer lattice: coordinates are hashed
directly, never wrapped with a modulo.  Therefore the pattern cannot repeat
along the screen edges or across frames, regardless of resolution.

Temporal stability is obtained by treating time as a third (continuous)
dimension instead of re-seeding white noise every frame.  Consecutive frames
sample neighbouring slices of the same 3-D value-noise field, so the grain
drifts/evolves smoothly rather than being fully re-randomised each frame.
"""

from __future__ import annotations

import numpy as np

_MASK32 = np.uint32(0xFFFFFFFF)


def _hash3i(ix: np.ndarray, iy: np.ndarray, iz: np.ndarray,
            seed: np.uint32) -> np.ndarray:
    """Hash integer lattice points into uniform float32 values in [0, 1).

    Pure 32-bit integer arithmetic, equivalent to the GLSL reference shader.
    No coordinate wrapping occurs, so the lattice is effectively infinite.
    """
    x = ix.astype(np.uint32)
    y = iy.astype(np.uint32)
    z = iz.astype(np.uint32)

    # All arithmetic wraps modulo 2**32 in uint32, matching a GPU integer hash.
    with np.errstate(over="ignore"):
        h = x * np.uint32(374761393) + np.uint32(seed)
        h = (h ^ (h >> np.uint32(13))) * np.uint32(1274126177)
        h = h + y * np.uint32(668265263)
        h = (h ^ (h >> np.uint32(16))) * np.uint32(2246822519)
        h = h + z * np.uint32(3266489917)
        h = (h ^ (h >> np.uint32(13))) * np.uint32(1597334677)
        h = h ^ (h >> np.uint32(16))

    u = (h & _MASK32).astype(np.float32)
    return u * np.float32(1.0 / 4294967296.0)


def _smooth(t: np.ndarray) -> np.ndarray:
    return t * t * (np.float32(3.0) - np.float32(2.0) * t)


def value_noise_3d(px: np.ndarray, py: np.ndarray, t: float,
                   scale: float, seed: int = 0) -> np.ndarray:
    """Smooth 3-D value noise sampled at pixel coordinates (px, py).

    ``scale`` sets the grain size in pixels (lattice spacing).  Smaller values
    give fine grain, larger values give visibly coarser flakes.

    Returns float32 noise roughly uniform on [-1, 1] (mean ~ 0).
    """
    fx = px.astype(np.float32) * np.float32(1.0 / scale)
    fy = py.astype(np.float32) * np.float32(1.0 / scale)
    fz = np.float32(t)

    x0 = np.floor(fx).astype(np.int32)
    y0 = np.floor(fy).astype(np.int32)
    z0 = np.int32(np.floor(float(fz)))
    tx = _smooth(fx - np.floor(fx))
    ty = _smooth(fy - np.floor(fy))
    tz = _smooth(fz - np.floor(fz))

    s = np.uint32(seed)
    c000 = _hash3i(x0,     y0,     z0,     s)
    c100 = _hash3i(x0 + 1, y0,     z0,     s)
    c010 = _hash3i(x0,     y0 + 1, z0,     s)
    c110 = _hash3i(x0 + 1, y0 + 1, z0,     s)
    c001 = _hash3i(x0,     y0,     z0 + 1, s)
    c101 = _hash3i(x0 + 1, y0,     z0 + 1, s)
    c011 = _hash3i(x0,     y0 + 1, z0 + 1, s)
    c111 = _hash3i(x0 + 1, y0 + 1, z0 + 1, s)

    def lerp(a, b, w):
        return a + (b - a) * w

    nx00 = lerp(c000, c100, tx)
    nx10 = lerp(c010, c110, tx)
    nx01 = lerp(c001, c101, tx)
    nx11 = lerp(c011, c111, tx)
    nxy0 = lerp(nx00, nx10, ty)
    nxy1 = lerp(nx01, nx11, ty)
    n = lerp(nxy0, nxy1, tz)
    return (n - np.float32(0.5)) * np.float32(2.0)


def white_noise_2d(px: np.ndarray, py: np.ndarray, t: float,
                   seed: int = 0) -> np.ndarray:
    """One-shot white hash noise, kept only for comparison/tests."""
    z = np.int32(np.floor(t))
    return (_hash3i(px.astype(np.int32), py.astype(np.int32),
                    np.full_like(px, z), np.uint32(seed))
            - np.float32(0.5)) * np.float32(2.0)
