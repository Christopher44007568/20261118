"""Visualization helpers: normal color map, lit preview, height-diff debug."""
import numpy as np
from PIL import Image


def to_u8(a):
    return np.clip(a * 255.0, 0, 255).astype(np.uint8)


def normal_colormap(n):
    """OpenGL-style normal RGB: x -> red, y -> green, z -> blue."""
    rgb = (n + 1.0) * 0.5
    return to_u8(rgb)


def lit_preview(n, light_dir=(0.4, -0.5, 0.75), base=0.25):
    """Simple diffuse shading from a fixed directional light."""
    l = np.asarray(light_dir, float)
    l /= np.linalg.norm(l)
    shade = base + (1 - base) * np.clip(np.sum(n * l, axis=-1), 0, 1)
    return to_u8(np.stack([shade] * 3, axis=-1))


def height_diff_debug(measured, filtered, vmax=None):
    """Diverging map of what the filter removed (should track noise, not edges)."""
    d = measured - filtered
    if vmax is None:
        vmax = np.percentile(np.abs(d), 98) + 1e-9
    d = np.clip(d / vmax, -1, 1)
    # blue = removed peak, red = filled valley, white = unchanged
    r = np.where(d >= 0, 1.0, 1.0 + d)
    b = np.where(d <= 0, 1.0, 1.0 - d)
    g = 1.0 - np.abs(d)
    return to_u8(np.stack([r, g, b], axis=-1)), float(vmax)


def save_png(path, rgb):
    Image.fromarray(rgb).save(path)
