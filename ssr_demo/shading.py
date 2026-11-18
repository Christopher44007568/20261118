"""Direct lighting and the environment ambient term used as SSR fallback."""

from __future__ import annotations

import numpy as np

from . import mat as m
from .rasterizer import GBuffer

LIGHT_DIR_VIEW = m.normalize(np.array([-0.45, 0.8, -0.55]))
LIGHT_COLOR = np.array([1.05, 0.98, 0.9])


def environment_color(direction_view: np.ndarray) -> np.ndarray:
    """Analytic sky/ground environment in view space.

    This is the *correct* fallback colour used whenever the screen-space
    ray cannot find a reliable hit. It is a smooth gradient plus a bright
    sky lobe, so any wrong-pixel sampling is visually obvious.
    """
    d = m.normalize(direction_view)
    up = d[..., 1]
    sky = np.clip(up * 0.5 + 0.5, 0.0, 1.0)[..., None]
    horizon = np.exp(-((up[..., None]) ** 2) / 0.08)
    ground_tint = np.array([0.16, 0.15, 0.14])
    sky_tint = np.array([0.32, 0.47, 0.66])
    lobe_tint = np.array([0.95, 0.85, 0.65])
    color = ground_tint * (1.0 - sky) + sky_tint * sky
    color += lobe_tint * horizon * 0.35
    return color


def direct_lighting(gbuffer: GBuffer) -> np.ndarray:
    """Lambert + Blinn-Phong direct term; no reflections yet."""
    mask = gbuffer.material_id >= 0
    n = gbuffer.view_normal
    diffuse = np.clip(n @ LIGHT_DIR_VIEW, 0.0, 1.0)[..., None]
    half_vec = m.normalize(LIGHT_DIR_VIEW + np.array([0.0, 0.0, -1.0]))
    spec = np.clip(np.sum(n * half_vec, axis=-1), 0.0, 1.0)
    shininess = 2.0 / np.maximum(gbuffer.roughness ** 4, 1e-3) - 2.0
    specular = (spec ** np.clip(shininess, 1.0, 256.0))[..., None]
    dielectric = (1.0 - gbuffer.metallic[..., None])
    color = gbuffer.albedo * (0.12 + 0.88 * diffuse)
    color += dielectric * specular * 0.25 * LIGHT_COLOR
    return np.where(mask[..., None], color, 0.0)


def ambient_fallback(gbuffer: GBuffer, reflect_dir: np.ndarray | None = None) -> np.ndarray:
    """Ambient term for every shaded pixel.

    Reflections probe the environment along the reflection vector; ordinary
    ambient uses the hemisphere above the surface normal instead.
    """
    if reflect_dir is None:
        reflect_dir = gbuffer.view_normal
    env = environment_color(reflect_dir)
    # Metals tint the environment by albedo (conductor behaviour).
    tint = np.where(
        gbuffer.metallic[..., None] > 0.5,
        gbuffer.albedo * 0.8 + 0.2,
        np.ones_like(gbuffer.albedo),
    )
    return env * tint


def reflection_strength(gbuffer: GBuffer) -> np.ndarray:
    """Fresnel-ish weight: metals reflect strongly, rough surfaces less."""
    n_dot_v = np.clip(-gbuffer.view_normal[..., 2], 0.0, 1.0)
    fresnel = 0.04 + 0.96 * (1.0 - n_dot_v) ** 5
    weight = gbuffer.metallic * (0.35 + 0.65 * fresnel)
    weight += (1.0 - gbuffer.metallic) * fresnel * 0.5
    weight *= np.clip(1.35 - gbuffer.roughness, 0.15, 1.0)
    return np.where(gbuffer.material_id >= 0, weight, 0.0)
