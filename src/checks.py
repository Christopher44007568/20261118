"""Energy conservation, seam and mip-continuity checks."""
import numpy as np

from envmap import dir_to_uv
from prefilter import build_mip_chain, weighted_mean
from render import render_sphere, sample_env_trilinear, sample_level


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def white_furnace(lut, roughness_list=(0.0, 0.25, 0.5, 0.75, 1.0), size=192):
    """Strict furnace: constant unit env, F0=1 sphere must reflect exactly 1."""
    unit_mips = build_mip_chain(np.ones((64, 128, 3), dtype=np.float32))
    rows = []
    imgs = []
    for r in roughness_list:
        mat = {"roughness": r, "f0": (1.0, 1.0, 1.0)}
        img, mask = render_sphere(unit_mips, lut, mat, size=size, return_mask=True)
        vals = luminance(img)[mask]
        rows.append((r, vals.mean(), vals.min(), vals.max()))
        img[~mask] = 0.0
        imgs.append(img)
    return rows, imgs


def env_reflectance(mips, lut, roughness_list=(0.0, 0.25, 0.5, 0.75, 1.0), size=192):
    """Real-env sanity: F0=1 sphere mean luminance vs env weighted mean."""
    env_lum = luminance(weighted_mean(mips[0])).item()
    rows = []
    for r in roughness_list:
        mat = {"roughness": r, "f0": (1.0, 1.0, 1.0)}
        img, mask = render_sphere(mips, lut, mat, size=size, return_mask=True)
        rows.append((r, luminance(img)[mask].mean() / env_lum))
    return rows


def material_energy(mips, lut, materials, size=192):
    """Mean reflected luminance of each material, relative to env mean."""
    env_lum = luminance(weighted_mean(mips[0])).item()
    out = []
    for name, mat in materials.items():
        img, mask = render_sphere(mips, lut, mat, size=size, return_mask=True)
        out.append((name, luminance(img)[mask].mean() / env_lum))
    return out


def seam_stats(mips):
    """Seam neighbor diff vs interior neighbor diff, per mip (ratio ~1 = invisible)."""
    rows = []
    for i, m in enumerate(mips):
        h, w = m.shape[:2]
        seam = np.abs(m[:, 0] - m[:, -1]).mean()
        interior = np.abs(np.diff(m, axis=1)).mean() if w > 1 else seam
        pole_top = m[0].std(axis=0).max()
        pole_bot = m[-1].std(axis=0).max()
        rows.append((i, seam, interior, seam / max(interior, 1e-12), pole_top, pole_bot))
    return rows


def mip_continuity(mips, dirs, steps=400):
    """Sweep roughness for fixed dirs; max step jump, trilinear vs nearest mip."""
    rough = np.linspace(0.0, 1.0, steps)
    d = np.broadcast_to(dirs, (steps, 3)).astype(np.float64)
    tri = sample_env_trilinear(mips, d, rough)
    u, v = dir_to_uv(d)
    lvl = np.round(rough * (len(mips) - 1)).astype(int)
    near = np.zeros_like(tri)
    for l in range(len(mips)):
        m = lvl == l
        if m.any():
            near[m] = sample_level(mips[l], u[m], v[m])
    jump_tri = np.abs(np.diff(tri, axis=0)).max()
    jump_near = np.abs(np.diff(near, axis=0)).max()
    return jump_tri, jump_near, tri, near, rough
