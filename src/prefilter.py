"""Specular prefilter mip chain for an equirect HDR environment.

Each level is a solid-angle-weighted 2x2 downsample of the previous one,
followed by a small horizontally-wrapping Gaussian blur to remove box
artifacts. Weighting by sin(theta) makes the 1x1 top mip exactly the
solid-angle-weighted average of mip 0, so the coarsest level is a smooth
noise-free mean color by construction.
"""
import numpy as np

from envmap import solid_angle_weights


def _gauss_kernel(sigma):
    r = max(1, int(np.ceil(3.0 * sigma)))
    x = np.arange(-r, r + 1)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    return k / k.sum()


def _convolve_axis(img, kernel, axis, wrap):
    r = len(kernel) // 2
    out = np.zeros_like(img)
    for i, wgt in enumerate(kernel):
        off = i - r
        if wrap:
            out += wgt * np.roll(img, -off, axis=axis)
        else:
            shifted = np.roll(img, -off, axis=axis)
            idx = [slice(None)] * img.ndim
            if off > 0:
                idx[axis] = slice(-off, None)
                edge = np.take(img, -1, axis=axis)
            elif off < 0:
                idx[axis] = slice(None, -off)
                edge = np.take(img, 0, axis=axis)
            else:
                out += wgt * shifted
                continue
            shifted[tuple(idx)] = np.expand_dims(edge, axis)
            out += wgt * shifted
    return out


def blur_equirect(img, sigma):
    """Separable Gaussian; wraps in u (longitude), clamps in v (latitude)."""
    if sigma <= 0.0:
        return img
    k = _gauss_kernel(sigma)
    img = _convolve_axis(img, k, axis=1, wrap=True)
    img = _convolve_axis(img, k, axis=0, wrap=False)
    return img


def downsample_weighted(img):
    """2x2 downsample weighted by texel solid angle (sin theta per row)."""
    h, w = img.shape[:2]
    if h == 1:
        return img.mean(axis=1, keepdims=True)
    sw = solid_angle_weights(h)
    w0 = sw[0::2][:, None, None]
    w1 = sw[1::2][:, None, None]
    top = img[0::2, :, :].reshape(h // 2, 2, w // 2, 3).sum(axis=1)
    bot = img[1::2, :, :].reshape(h // 2, 2, w // 2, 3).sum(axis=1)
    return (top * w0 + bot * w1) / (2.0 * (w0 + w1))


def build_mip_chain(env, num_levels=None, blur_sigma=0.6):
    h, w = env.shape[:2]
    max_levels = int(np.log2(w)) + 1
    n = num_levels or max_levels
    n = min(n, max_levels)
    mips = [env.astype(np.float32)]
    target_mean = weighted_mean(env)
    while len(mips) < n:
        nxt = downsample_weighted(mips[-1])
        nxt = blur_equirect(nxt, blur_sigma)
        # Pole rows map to a single direction: collapse them to their mean so
        # reflections near the poles have no pinch seam.
        if nxt.shape[0] > 1:
            nxt[0, :] = nxt[0, :].mean(axis=0)
            nxt[-1, :] = nxt[-1, :].mean(axis=0)
        # The blur is not solid-angle aware; renormalize so every level keeps
        # mip 0's weighted mean. The 1x1 top mip is then exactly the global
        # average color and the chain conserves energy.
        cur = weighted_mean(nxt)
        nxt = nxt * (target_mean / np.maximum(cur, 1e-8))
        mips.append(nxt.astype(np.float32))
    return mips


def weighted_mean(img):
    h = img.shape[0]
    sw = solid_angle_weights(h)[:, None, None]
    return (img * sw).sum(axis=(0, 1)) / (sw.sum() * img.shape[1])
