"""Procedural PBR-like test materials: clean height, roughness map, measured height.

The clean height defines ground-truth normals. The measured height adds
micro-scale surface noise whose amplitude is driven by the roughness map,
mimicking a real height/normal capture: rough regions contain high-frequency
micro-relief that must be filtered rather than interpreted as sharp slopes.
"""
import numpy as np


def _smooth_grid(rng, size, cells, low, high):
    """Piecewise-smooth random field with bilinear interpolation (soft edges)."""
    g = rng.uniform(low, high, (cells, cells))
    idx = np.linspace(0, cells - 1, size)
    i0 = np.floor(idx).astype(int)
    i1 = np.minimum(i0 + 1, cells - 1)
    t = (idx - i0)[:, None]
    row = g[i0][:, i0[0]] * (1 - t) + g[i1][:, i1[0]] * t
    t2 = t.T
    field = row[:, i0] * (1 - t2) + row[:, i1] * t2
    return field


def _smooth_noise(rng, size, sigma):
    from scipy.ndimage import gaussian_filter
    return gaussian_filter(rng.standard_normal((size, size)), sigma)


def stone_wall(size=512, seed=11):
    """Coursed stone blocks with raised faces and recessed mortar joints."""
    rng = np.random.default_rng(seed)
    rows, cols = 6, 8
    bh, bw = size / rows, size / cols
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    h = np.zeros((size, size))
    rough = np.full((size, size), 0.55)
    cell_h = np.zeros((rows, cols))
    for r in range(rows):
        for c in range(cols):
            cell_h[r, c] = rng.uniform(0.55, 0.9)
    # block faces with smoothly rounded edges (tanh profiles keep clean edges)
    gy = (yy % bh) / bh
    gx = (xx % bw) / bw
    edge = 0.12
    py = 0.5 * (np.tanh((gy - edge) / 0.03) + np.tanh((1 - edge - gy) / 0.03))
    px = 0.5 * (np.tanh((gx - edge) / 0.03) + np.tanh((1 - edge - gx) / 0.03))
    block_mask = np.clip(py * px, 0, 1)
    ridx = np.clip((yy // bh).astype(int), 0, rows - 1)
    cidx = np.clip((xx // bw).astype(int), 0, cols - 1)
    face_level = cell_h[ridx, cidx]
    # subtle per-block large-scale warping (real macro geometry)
    warp = 0.05 * _smooth_noise(rng, size, 14)
    h = 0.12 + face_level * block_mask + warp * block_mask
    # mortar = recessed smooth valleys
    h = h * block_mask + 0.12 * (1 - block_mask)
    rough = np.where(block_mask > 0.5, 0.62, 0.85)
    rough += 0.05 * _smooth_noise(rng, size, 9)
    return _finish(h, rough, rng, noise_sigma=1.6, rough_gain=1.0)


def fabric(size=512, seed=23):
    """Woven cloth: orthogonal thread bundles plus a slow fold. All smooth."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    pitch = 20.0
    # sinusoidal weave threads (derivatives stay bounded and smooth)
    weave = 0.10 * (np.sin(2 * np.pi * yy / pitch)
                    + 0.8 * np.sin(2 * np.pi * xx / pitch + 0.7))
    # over/under checker modulation of amplitude
    over = ((np.floor(yy / pitch) + np.floor(xx / pitch)) % 2) * 2 - 1
    weave *= 0.5 + 0.5 * over * 0.6
    fold = 0.18 * np.sin(2 * np.pi * xx / size * 1.5 + 0.4) \
        + 0.10 * np.cos(2 * np.pi * yy / size)
    h = 0.5 + fold + weave
    # roughness: threads themselves slightly rougher, overall medium-high
    rough = 0.7 + 0.1 * np.sin(2 * np.pi * yy / pitch) \
        + 0.04 * _smooth_noise(rng, size, 6)
    return _finish(h, rough, rng, noise_sigma=1.2, rough_gain=1.0)


def metal_scratch(size=512, seed=37):
    """Smooth brushed metal plate with a few shallow grooves (scratches)."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    # broad smooth bowing of the sheet
    h = 0.5 + 0.06 * np.sin(2 * np.pi * xx / size * 2 + 1.0) \
        + 0.04 * np.cos(2 * np.pi * yy / size * 1.3)
    h += 0.03 * _smooth_noise(rng, size, 25)
    # polished base; scratch interiors are rougher
    rough = np.full((size, size), 0.18)
    n_scratch = 14
    for _ in range(n_scratch):
        angle = rng.uniform(-0.25, 0.25)
        length = rng.uniform(90, 300)
        x0 = rng.uniform(0, size)
        y0 = rng.uniform(0, size)
        depth = rng.uniform(0.03, 0.09)
        width = rng.uniform(1.2, 2.6)
        d = (xx - x0) * np.sin(angle) - (yy - y0) * np.cos(angle)
        along = (xx - x0) * np.cos(angle) + (yy - y0) * np.sin(angle)
        taper = np.clip(1 - np.abs(along) / (length / 2), 0, 1)
        groove = depth * np.exp(-(d ** 2) / (2 * width ** 2)) * taper ** 2
        h -= groove
        rough += 0.35 * np.exp(-(d ** 2) / (2 * (width * 1.6) ** 2)) * taper ** 2
    rough = np.clip(rough, 0.05, 0.6)
    return _finish(h, rough, rng, noise_sigma=1.0, rough_gain=1.0)


def _finish(h, rough, rng, noise_sigma, rough_gain):
    from scipy.ndimage import gaussian_filter
    h = (h - h.min()) / (np.ptp(h) + 1e-12)
    rough = np.clip(rough, 0.02, 0.98)
    # measured micro-relief: high-frequency noise scaled by local roughness.
    # Fine scale (sigma ~ 1 px) so it behaves like pixel-scale capture noise,
    # not like genuine macro slopes.
    micro = gaussian_filter(rng.standard_normal(h.shape), noise_sigma * 0.6)
    micro /= micro.std() + 1e-12
    amplitude = (0.012 + 0.05 * rough ** 1.5) * rough_gain
    measured = h + amplitude * micro
    measured = (measured - measured.min()) / (np.ptp(measured) + 1e-12)
    return {
        "height": h.astype(np.float64),
        "measured": measured.astype(np.float64),
        "roughness": rough.astype(np.float64),
    }


MATERIALS = {
    "stone_wall": stone_wall,
    "fabric": fabric,
    "metal_scratch": metal_scratch,
}
