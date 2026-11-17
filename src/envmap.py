"""Equirectangular environment map: direction mapping and procedural HDR sky."""
import numpy as np


def uv_to_dir(u, v):
    """u,v in [0,1] -> unit direction. v=0 is +Y (zenith)."""
    theta = v * np.pi
    phi = (u - 0.5) * 2.0 * np.pi
    s = np.sin(theta)
    return np.stack([s * np.cos(phi), np.cos(theta), s * np.sin(phi)], axis=-1)


def dir_to_uv(d):
    """Unit directions (...,3) -> (u, v) in [0,1]."""
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    u = np.arctan2(z, x) / (2.0 * np.pi) + 0.5
    v = np.arccos(np.clip(y, -1.0, 1.0)) / np.pi
    return u, v


def solid_angle_weights(h):
    """Per-row texel solid angle (up to constant dphi) for an h-row equirect."""
    theta = (np.arange(h) + 0.5) * np.pi / h
    return np.sin(theta)


def _value_noise_3d(p, period, rng):
    """Tileable trilinear value noise; p is (...,3), lattice period `period`."""
    p0 = np.floor(p).astype(np.int64)
    f = p - p0
    f = f * f * (3.0 - 2.0 * f)
    corners = []
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                c = p0 + np.array([dx, dy, dz])
                idx = (c[..., 0] % period
                       + (c[..., 1] % period) * period
                       + (c[..., 2] % period) * period * period)
                corners.append(rng[idx])
    c000, c100, c010, c110, c001, c101, c011, c111 = corners
    x00 = c000 + (c100 - c000) * f[..., 0]
    x10 = c010 + (c110 - c010) * f[..., 0]
    x01 = c001 + (c101 - c001) * f[..., 0]
    x11 = c011 + (c111 - c011) * f[..., 0]
    y0 = x00 + (x10 - x00) * f[..., 1]
    y1 = x01 + (x11 - x01) * f[..., 1]
    return y0 + (y1 - y0) * f[..., 2]


def fbm(p, base_period=8, octaves=5, seed=7):
    """Seamless fractal noise on the sphere: a pure function of 3D direction."""
    total, amp, norm = 0.0, 1.0, 0.0
    period = base_period
    for o in range(octaves):
        rng = np.random.default_rng(seed + o).random(period ** 3)
        total += amp * _value_noise_3d(p * period, period, rng)
        norm += amp
        amp *= 0.5
        period *= 2
    return total / norm


def generate_env(h=512, w=1024, seed=7):
    """Procedural HDR equirect: sky gradient, HDR sun, clouds, ground, light strips."""
    v, u = np.mgrid[0:h, 0:w]
    d = uv_to_dir((u + 0.5) / w, (v + 0.5) / h)
    y = d[..., 1]

    zenith = np.array([0.09, 0.22, 0.55]) * 1.6
    horizon = np.array([0.95, 0.75, 0.55]) * 1.1
    t = np.clip(y, 0.0, 1.0)[..., None] ** 0.6
    sky = horizon * (1.0 - t) + zenith * t

    ground_a = np.array([0.16, 0.13, 0.09])
    ground_b = np.array([0.05, 0.09, 0.05])
    gn = fbm(d * 3.0, seed=seed + 40)[..., None]
    ground = ground_a * (0.5 + gn) + ground_b * (1.0 - gn)
    env = np.where(y[..., None] >= 0.0, sky, ground)

    cloud = fbm(d * 2.0 + 11.0, seed=seed + 1)
    cover = np.clip((cloud - 0.52) * 6.0, 0.0, 1.0) * np.clip(y * 4.0, 0.0, 1.0)
    cloud_col = np.array([1.5, 1.45, 1.35])
    env = env * (1.0 - cover[..., None] * 0.85) + cloud_col * cover[..., None]

    sun_dir = np.array([0.45, 0.42, -0.79])
    sun_dir /= np.linalg.norm(sun_dir)
    cos_sun = d @ sun_dir
    disk = np.clip((cos_sun - 0.9995) / 0.0004, 0.0, 1.0)
    glow = np.clip(cos_sun, 0.0, None) ** 256.0
    env += disk[..., None] * np.array([180.0, 160.0, 130.0])
    env += glow[..., None] * np.array([6.0, 4.5, 3.0])

    phi = (np.arctan2(d[..., 2], d[..., 0]) / (2 * np.pi) + 0.5)
    for c0, c1, col in ((0.12, 0.16, [9.0, 7.0, 4.0]),
                        (0.58, 0.63, [4.0, 6.0, 9.0]),
                        (0.83, 0.86, [8.0, 5.0, 6.0])):
        m = (phi > c0) & (phi < c1) & (np.abs(y) < 0.09)
        env[m] += np.array(col) * (0.7 + 0.6 * fbm(d[m] * 6.0, seed=seed + 9)[..., None])

    return env.astype(np.float32)
