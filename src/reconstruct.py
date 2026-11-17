"""Normal reconstruction from height maps with roughness-aware filtering.

Methods
-------
central : central finite differences on the (optionally pre-smoothed) height.
sobel   : 3x3 Sobel gradient, optionally on the pre-smoothed height.
adaptive: roughness-driven bilateral smoothing (edge preserving) followed by
          a least-squares plane-gradient inside an adaptive window. Rough
          regions get a wide spatial kernel but range weighting still blocks
          smoothing across genuine height discontinuities, so micro-noise is
          removed without inventing sharp bevels.

Height is normalized to [0, 1]; gradients are multiplied by a strength
constant so normals span a comparable dynamic range across materials.
"""
import numpy as np
from scipy.ndimage import gaussian_filter, uniform_filter

STRENGTH = 6.0


def central_gradient(h):
    gy, gx = np.zeros_like(h), np.zeros_like(h)
    gy[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
    gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
    # one-sided differences at the border
    gy[0, :] = h[1, :] - h[0, :]
    gy[-1, :] = h[-1, :] - h[-2, :]
    gx[:, 0] = h[:, 1] - h[:, 0]
    gx[:, -1] = h[:, -1] - h[:, -2]
    return gy * STRENGTH, gx * STRENGTH


def sobel_gradient(h):
    k_y = np.array([[1, 2, 1], [0, 0, 0], [-1, -2, -1]], float) / 4.0
    k_x = k_y.T
    from scipy.signal import convolve2d
    gy = convolve2d(h, k_y, boundary="symm", mode="same")
    gx = convolve2d(h, k_x, boundary="symm", mode="same")
    return gy * STRENGTH, gx * STRENGTH


def make_normal(gy, gx):
    """Normal for height field z = h: n = (-dx, -dy, 1) normalized."""
    inv = 1.0 / np.sqrt(gx ** 2 + gy ** 2 + 1.0)
    return np.stack([-gx * inv, -gy * inv, inv], axis=-1)


def gaussian_prefilter(h, radius):
    if radius <= 0:
        return h
    return gaussian_filter(h, sigma=radius / 2.0, mode="reflect")


def bilateral_filter(h, sigma_s, sigma_r):
    """Edge-preserving smoothing; vectorized over a (2r+1) window."""
    if sigma_s <= 0:
        return h
    r = max(1, int(round(2 * sigma_s)))
    pad = np.pad(h, r, mode="reflect")
    ys, xs = np.mgrid[-r:r + 1, -r:r + 1]
    spatial = np.exp(-(ys ** 2 + xs ** 2) / (2 * sigma_s ** 2))
    acc = np.zeros_like(h)
    wsum = np.zeros_like(h)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            shifted = pad[r + dy:r + dy + h.shape[0],
                          r + dx:r + dx + h.shape[1]]
            w = spatial[dy + r, dx + r] * np.exp(
                -((shifted - h) ** 2) / (2 * sigma_r ** 2))
            acc += w * shifted
            wsum += w
    return acc / (wsum + 1e-12)


def adaptive_filter(h, roughness, radius, edge_strength=1.0):
    """Roughness-aware bilateral smoothing.

    Spatial extent grows with roughness (noisy regions get wider averaging),
    while the range sigma shrinks where edge protection is requested so real
    height steps (mortar joints, scratch walls) keep their profile.
    """
    # per-pixel spatial sigma in [radius*0.4, radius*1.4]
    sigma_s_map = radius * (0.4 + 1.4 * roughness)
    sigma_s = float(np.median(sigma_s_map))
    # range sigma: smaller -> stronger edge protection
    sigma_r = 0.08 / edge_strength
    return bilateral_filter(h, sigma_s, max(sigma_r, 1e-3))


def plane_gradient(h, radius, edge_mask=None, sigma_r=0.05):
    """Weighted local least-squares plane slope in a (2r+1) window.

    Range weights down-weight neighbors across height discontinuities, which
    is the edge-preserving term. With uniform weights this reduces to a
    smoothed central-difference gradient.
    """
    r = max(1, int(round(radius)))
    pad = np.pad(h, r, mode="reflect")
    acc_gx = np.zeros_like(h)
    acc_gy = np.zeros_like(h)
    wsum = np.zeros_like(h)
    # precompute spatial weights and centered offsets
    ys, xs = np.mgrid[-r:r + 1, -r:r + 1]
    spatial = np.exp(-(ys ** 2 + xs ** 2) / (2 * (r / 1.5) ** 2))
    w_sum = np.zeros_like(h)
    sxx = np.zeros_like(h)
    syy = np.zeros_like(h)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            shifted = pad[r + dy:r + dy + h.shape[0],
                          r + dx:r + dx + h.shape[1]]
            w = spatial[dy + r, dx + r] * np.exp(
                -((shifted - h) ** 2) / (2 * sigma_r ** 2))
            acc_gx += w * dx * (shifted - h)
            acc_gy += w * dy * (shifted - h)
            wsum += w
            sxx += w * dx * dx
            syy += w * dy * dy
    gx = acc_gx / (sxx + 1e-12)
    gy = acc_gy / (syy + 1e-12)
    return gy * STRENGTH, gx * STRENGTH


def reconstruct(measured, roughness, method, radius, edge_strength=1.0):
    """Return normal map (H,W,3) and the filtered height used for gradients."""
    if method == "central":
        hf = gaussian_prefilter(measured, radius)
        gy, gx = central_gradient(hf)
    elif method == "sobel":
        hf = gaussian_prefilter(measured, radius)
        gy, gx = sobel_gradient(hf)
    elif method == "adaptive":
        hf = adaptive_filter(measured, roughness, radius, edge_strength)
        # Edge preservation is carried by the range kernel of the bilateral
        # filter; central differences on its output keep genuine steps sharp
        # while a windowed plane fit would shrink their slopes.
        gy, gx = central_gradient(hf)
    else:
        raise ValueError(method)
    return make_normal(gy, gx), hf
