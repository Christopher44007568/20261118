"""Split-sum BRDF LUT: E = F0*scale + bias, integrated by Monte Carlo."""
import numpy as np


def integrate_brdf_lut(size=64, samples=512, seed=3):
    """Returns (size, size, 2) LUT indexed by [roughness, ndotv] -> (A, B)."""
    rng = np.random.default_rng(seed)
    xi = rng.random((size, size, samples, 2)).astype(np.float64)

    ndotv = (np.arange(size) + 0.5) / size
    rough = (np.arange(size) + 0.5) / size
    ndotv_g = ndotv[None, :, None]
    rough_g = rough[:, None, None]
    a = rough_g * rough_g

    xi1 = xi[..., 0]
    xi2 = xi[..., 1]
    phi = 2.0 * np.pi * xi1
    cos_t = np.sqrt((1.0 - xi2) / (1.0 + (a * a - 1.0) * xi2))
    sin_t = np.sqrt(np.maximum(1.0 - cos_t * cos_t, 0.0))
    hx = sin_t * np.cos(phi)
    hy = sin_t * np.sin(phi)
    hz = cos_t

    vx = np.sqrt(np.maximum(1.0 - ndotv_g * ndotv_g, 0.0))
    vz = ndotv_g
    vdh = vx * hx + vz * hz
    lz = 2.0 * vdh * hz - vz
    ndotl = np.maximum(lz, 0.0)
    ndoth = np.maximum(hz, 1e-6)

    k = a / 2.0
    gv = ndotv_g / (ndotv_g * (1.0 - k) + k)
    gl = ndotl / (ndotl * (1.0 - k) + k)
    g = gv * gl
    g_vis = g * vdh / (ndoth * ndotv_g)
    g_vis = np.where(ndotl > 0.0, g_vis, 0.0)
    fc = (1.0 - np.clip(vdh, 0.0, 1.0)) ** 5

    scale = ((1.0 - fc) * g_vis).mean(axis=-1)
    bias = (fc * g_vis).mean(axis=-1)
    return np.stack([scale, bias], axis=-1).astype(np.float32)


def sample_lut(lut, roughness, ndotv):
    """Bilinear LUT sample. roughness, ndotv are broadcastable arrays."""
    n = lut.shape[0]
    fr = np.clip(roughness, 0.0, 1.0) * (n - 1)
    fv = np.clip(ndotv, 0.0, 1.0) * (n - 1)
    r0, v0 = np.floor(fr).astype(int), np.floor(fv).astype(int)
    r1, v1 = np.minimum(r0 + 1, n - 1), np.minimum(v0 + 1, n - 1)
    tr, tv = (fr - r0)[..., None], (fv - v0)[..., None]
    c00 = lut[r0, v0] * (1 - tr) + lut[r1, v0] * tr
    c01 = lut[r0, v1] * (1 - tr) + lut[r1, v1] * tr
    return c00 * (1 - tv) + c01 * tv
