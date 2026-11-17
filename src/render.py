"""PBR sphere renderer with roughness-driven trilinear mip sampling."""
import numpy as np

from envmap import dir_to_uv
from brdf_lut import sample_lut


def sample_level(mip, u, v):
    """Bilinear sample; wraps in u, clamps in v."""
    h, w = mip.shape[:2]
    x = u * w - 0.5
    y = v * h - 0.5
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    tx = (x - x0)[..., None]
    ty = (y - y0)[..., None]
    x0w, x1w = x0 % w, (x0 + 1) % w
    y0c = np.clip(y0, 0, h - 1)
    y1c = np.clip(y0 + 1, 0, h - 1)
    c00 = mip[y0c, x0w] * (1 - tx) + mip[y0c, x1w] * tx
    c01 = mip[y1c, x0w] * (1 - tx) + mip[y1c, x1w] * tx
    return c00 * (1 - ty) + c01 * ty


def sample_env_trilinear(mips, dirs, roughness):
    """Trilinear (2 spatial + 1 mip) sample -> continuous across mip switches."""
    u, v = dir_to_uv(dirs)
    mipf = np.clip(roughness, 0.0, 1.0) * (len(mips) - 1)
    l0 = np.floor(mipf).astype(int)
    l1 = np.minimum(l0 + 1, len(mips) - 1)
    frac = (mipf - l0)[..., None]
    l0s = np.clip(l0, 0, len(mips) - 1)
    c0 = np.zeros(dirs.shape, dtype=np.float32)
    c1 = np.zeros(dirs.shape, dtype=np.float32)
    for lvl in range(len(mips)):
        m0 = l0s == lvl
        if m0.any():
            c0[m0] = sample_level(mips[lvl], u[m0], v[m0])
        m1 = l1 == lvl
        if m1.any():
            c1[m1] = sample_level(mips[lvl], u[m1], v[m1])
    return c0 * (1 - frac) + c1 * frac


def ray_sphere(cam, dirs, center, radius):
    """Returns hit mask and ray parameter t for a sphere."""
    oc = cam - center
    b = (dirs * oc).sum(-1)
    c = (oc * oc).sum(-1) - radius * radius
    disc = b * b - c
    hit = disc > 0
    t = -b - np.sqrt(np.maximum(disc, 0.0))
    return hit & (t > 0), t


def render_sphere(mips, lut, material, size=384, fov_deg=32.0, cam_pos=(0, 0, 3.2),
                  radius=1.0, center=(0, 0, 0), bg_mip=0, return_mask=False):
    """Render one sphere against the environment background."""
    cam = np.array(cam_pos, dtype=np.float64)
    cen = np.array(center, dtype=np.float64)
    f = np.tan(np.radians(fov_deg) / 2.0)
    py, px = np.mgrid[0:size, 0:size]
    ndc_x = (2.0 * (px + 0.5) / size - 1.0) * f
    ndc_y = (1.0 - 2.0 * (py + 0.5) / size) * f
    fwd = cen - cam
    fwd /= np.linalg.norm(fwd)
    up_hint = np.array([0.0, 1.0, 0.0])
    if abs(fwd @ up_hint) > 0.99:
        up_hint = np.array([0.0, 0.0, 1.0])
    right = np.cross(fwd, up_hint)
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    dirs = (ndc_x[..., None] * right + ndc_y[..., None] * up + fwd)
    dirs /= np.linalg.norm(dirs, axis=-1, keepdims=True)

    hit, t = ray_sphere(cam, dirs, cen, radius)
    img = sample_level(mips[bg_mip], *dir_to_uv(dirs))

    if hit.any():
        pos = cam + dirs * t[..., None]
        n = pos - cen
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        v = -dirs
        r = 2.0 * (n * v).sum(-1, keepdims=True) * n - v
        r /= np.linalg.norm(r, axis=-1, keepdims=True)
        ndotv = np.clip((n * v).sum(-1), 0.0, 1.0)

        rough = material["roughness"]
        f0 = np.array(material["f0"], dtype=np.float32)
        spec_env = sample_env_trilinear(mips, r, np.full_like(ndotv, rough))
        ab = sample_lut(lut, np.full_like(ndotv, rough), ndotv)
        f_ss = f0 * ab[..., 0:1] + ab[..., 1:2]
        # Kulla-Conty multi-scattering compensation: adds back the energy the
        # single-scatter GGX lobe loses to masking, so a white furnace stays
        # white at any roughness.
        ess = (ab[..., 0:1] + ab[..., 1:2])
        ems = 1.0 - ess
        f_avg = f0 + (1.0 - f0) / 21.0
        f_ms = f_ss * f_avg / np.maximum(1.0 - ems * f_avg, 1e-6)
        spec = spec_env * (f_ss + f_ms * ems)

        out = spec
        if material.get("diffuse", 0.0) > 0.0:
            irr = mips[-1].reshape(1, 1, 3)
            albedo = np.array(material.get("albedo", (1, 1, 1)), dtype=np.float32)
            fres = f0 + (1.0 - f0) * (1.0 - ndotv[..., None]) ** 5
            out = out + material["diffuse"] * albedo * irr * (1.0 - fres)
        if material.get("tint") is not None:
            out = out * np.array(material["tint"], dtype=np.float32)
        img[hit] = out[hit]
    if return_mask:
        return img, hit
    return img
