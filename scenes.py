"""Procedural test scenes for anti-aliasing evaluation.

Every scene is a pure function of continuous pixel coordinates, so it can
be rendered at any resolution:
  - render at 1x            -> aliased input (point sampled)
  - render at SS x SS and
    box-downsample to 1x    -> ground truth reference
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFont

SS = 4  # supersampling factor for the ground truth


def _coords(size, ss):
    n = size * ss
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    return (x + 0.5) / ss, (y + 0.5) / ss  # continuous coords in 1x pixels


def _rot(x, y, deg):
    a = np.deg2rad(deg, dtype=np.float32)
    return x * np.cos(a) - y * np.sin(a), x * np.sin(a) + y * np.cos(a)


def _to_rgb(gray):
    return np.repeat(gray[..., None].astype(np.float32), 3, axis=2)


def scene_grid(size=256, ss=1):
    """High-contrast rotated grid: white 2px lines on black, spacing 16px."""
    x, y = _coords(size, ss)
    u, v = _rot(x, y, 7.0)
    line = 2.0
    gu = (u % 16.0) < line
    gv = (v % 16.0) < line
    gray = np.where(gu | gv, 0.95, 0.05)
    return _to_rgb(gray)


def scene_railings(size=256, ss=1):
    """Thin railings: ~1.5px bright bars every 8px, slightly tilted."""
    x, y = _coords(size, ss)
    u, _ = _rot(x, y, 2.5)
    bars = (u % 8.0) < 1.5
    gray = np.where(bars, 0.9, 0.12)
    # Slight vertical falloff so bar tops/bottoms also form edges.
    gray = gray * (0.75 + 0.25 * (y / size))
    return _to_rgb(gray.astype(np.float32))


def scene_gradient(size=256, ss=1):
    """Low-contrast scene: smooth gradient with a soft diagonal boundary."""
    x, y = _coords(size, ss)
    base = 0.30 + 0.20 * (y / size)
    u, _ = _rot(x - size * 0.5, y - size * 0.5, 20.0)
    soft = 0.06 * np.tanh(u / 6.0)  # low contrast (~6%) diagonal step
    ripple = 0.02 * np.sin(x * 0.15) * np.sin(y * 0.11)
    gray = base + soft + ripple
    return _to_rgb(np.clip(gray, 0.0, 1.0).astype(np.float32))


def _font(px):
    import matplotlib
    import os
    path = os.path.join(os.path.dirname(matplotlib.__file__),
                        "mpl-data", "fonts", "ttf", "DejaVuSans.ttf")
    return ImageFont.truetype(path, px)


def scene_text(size=256, ss=1):
    """Text edges: white ASCII text on dark background, slightly rotated."""
    n = size * ss
    img = Image.new("L", (n, n), 18)
    draw = ImageDraw.Draw(img)
    draw.text((int(10 * ss), int(20 * ss)), "Anti-Aliasing", font=_font(30 * ss),
              fill=235)
    draw.text((int(10 * ss), int(70 * ss)), "FXAA quality 3.11", font=_font(22 * ss),
              fill=220)
    draw.text((int(10 * ss), int(110 * ss)), "jagged edges 2026", font=_font(16 * ss),
              fill=210)
    draw.text((int(10 * ss), int(140 * ss)), "thin serifs |il1| 0O@", font=_font(13 * ss),
              fill=200)
    img = img.rotate(-4.0, resample=Image.NEAREST, fillcolor=18)
    gray = np.asarray(img, dtype=np.float32) / 255.0
    return _to_rgb(gray)


SCENES = {
    "grid": scene_grid,
    "railings": scene_railings,
    "gradient": scene_gradient,
    "text": scene_text,
}


def downsample(img, ss):
    """Box-filter downsample by integer factor ss."""
    if ss == 1:
        return img
    h, w = img.shape[:2]
    out = img.reshape(h // ss, ss, w // ss, ss, -1).mean(axis=(1, 3))
    return out.astype(np.float32)


def render_pair(fn, size=256, ss=SS):
    """Return (aliased_input, ground_truth) for a scene function."""
    aliased = fn(size, 1)
    gt = downsample(fn(size, ss), ss)
    return aliased, gt
