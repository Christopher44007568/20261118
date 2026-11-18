"""Seeded, tileable noise texture generators.

Blue noise is built with Ulichney's void-and-cluster method on a
torus, so the texture tiles without seams and has no low-frequency
energy (no clumps, no checkerboard, no visible repeat blocks).
Everything is driven by an explicit seed: same seed -> same bytes.
"""

from __future__ import annotations

import numpy as np


def _gaussian_kernel(size: int, sigma: float) -> np.ndarray:
    half = size // 2
    ax = np.arange(-half, half + 1, dtype=np.float64)
    g = np.exp(-(ax**2) / (2.0 * sigma * sigma))
    kernel = np.outer(g, g)
    return kernel / kernel.sum()


def _toroidal_add(energy: np.ndarray, kernel: np.ndarray, y: int, x: int,
                  sign: float) -> None:
    """Add +/- kernel centered at (y, x) with wraparound, in place."""
    n = energy.shape[0]
    k = kernel.shape[0]
    half = k // 2
    ys = (np.arange(y - half, y + half + 1) % n)[:, None]
    xs = (np.arange(x - half, x + half + 1) % n)[None, :]
    energy[ys, xs] += sign * kernel


def blue_noise_texture(size: int = 128, seed: int = 1337,
                       sigma: float = 1.9,
                       initial_fraction: float = 0.1) -> np.ndarray:
    """Void-and-cluster threshold texture, values in [0, 1).

    Tileable by construction (all blurs are toroidal). Deterministic
    for a given (size, seed, sigma, initial_fraction).
    """
    rng = np.random.default_rng(seed)
    total = size * size
    kernel = _gaussian_kernel(9, sigma)

    pattern = np.zeros(total, dtype=bool)
    initial_count = int(total * initial_fraction)
    pattern[rng.choice(total, initial_count, replace=False)] = True
    pattern = pattern.reshape(size, size)

    energy = np.zeros((size, size))
    for y, x in np.argwhere(pattern):
        _toroidal_add(energy, kernel, y, x, +1.0)

    rank = np.empty(total, dtype=np.int64)

    # Phase 1: peel off tightest clusters; they get the LOW ranks so
    # that at low fill levels the remaining dots stay far apart.
    work = pattern.copy()
    for r in range(initial_count - 1, -1, -1):
        masked = np.where(work, energy, -np.inf)
        y, x = np.unravel_index(int(np.argmax(masked)), work.shape)
        work[y, x] = False
        rank[y * size + x] = r
        _toroidal_add(energy, kernel, y, x, -1.0)

    # Phase 2: restart from the INITIAL pattern (the pixels ranked in
    # phase 1) and fill the largest voids first, up to full coverage.
    work = pattern.copy()
    energy[:] = 0.0
    for y, x in np.argwhere(work):
        _toroidal_add(energy, kernel, y, x, +1.0)
    for r in range(initial_count, total):
        masked = np.where(work, np.inf, energy)
        y, x = np.unravel_index(int(np.argmin(masked)), work.shape)
        work[y, x] = True
        rank[y * size + x] = r
        _toroidal_add(energy, kernel, y, x, +1.0)

    return (rank.reshape(size, size) + 0.5) / total


def white_noise_texture(size: int = 128, seed: int = 1337) -> np.ndarray:
    """Uniform i.i.d. white noise in [0, 1). Deterministic per seed."""
    return np.random.default_rng(seed).random((size, size))


def bayer_matrix(level: int = 3) -> np.ndarray:
    """Ordered Bayer threshold matrix in [0, 1).

    Included as a negative control: its periodic 8x8 structure is
    exactly the checkerboard/repeat-block artifact we want to avoid.
    """
    m = np.array([[0, 2], [3, 1]], dtype=np.int64)
    for _ in range(level - 1):
        m = np.block([[4 * m, 4 * m + 2], [4 * m + 3, 4 * m + 1]])
    n = m.size
    return (m + 0.5) / n
