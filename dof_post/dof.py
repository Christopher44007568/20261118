"""Scatter-as-gather depth-of-field post-process.

Each output pixel gathers taps from a polygonal bokeh kernel. A tap only
contributes when the *tap's own* CoC disk covers the output pixel, so
in-focus content (CoC ~ 0) never bleeds onto its neighbours and edges on
the focal plane stay sharp.

Foreground (near) and background (far) fields are accumulated separately
with their own radius limits, then the near field is composited over the
far field. This prevents blurred foreground objects from being
contaminated by the background and vice versa.

Highlight taps get a bounded weight boost so bright spots read as bokeh
discs; because every field is normalised by its accumulated weight, the
blur conserves energy and cannot produce sampling holes.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .coc import LensSettings, signed_coc, split_fields
from .kernel import bokeh_kernel


@dataclass(frozen=True)
class DofSettings:
    """Quality and bokeh-shaping parameters for the DoF pass."""

    num_samples: int = 96
    blades: int = 6               # aperture blades; <3 gives a circle
    blade_rotation: float = 0.0   # radians
    highlight_threshold: float = 1.0   # linear luminance
    highlight_gain: float = 3.0        # bounded boost for bright taps
    edge_softness: float = 1.0         # px, softens the CoC coverage test


def _highlight_weights(color: np.ndarray, settings: DofSettings) -> np.ndarray:
    """Bounded per-pixel weight boost for highlights (bokeh brightness)."""
    lum = color @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    excess = np.clip(lum - settings.highlight_threshold, 0.0, None)
    boost = 1.0 + settings.highlight_gain * np.clip(excess, 0.0, 4.0)
    return boost.astype(np.float32)


def _gather_field(
    color: np.ndarray,
    radius: np.ndarray,
    offsets: np.ndarray,
    tap_boost: np.ndarray,
    softness: float,
    center_radius: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Gather one field (near or far).

    Returns (weighted colour sum, weight sum, raw coverage, max covering
    radius). A tap at distance ``dist`` contributes when
    ``radius_tap >= dist`` (with a soft edge), which is what keeps
    focal-plane edges sharp.

    When ``center_radius`` is given, the coverage radius is additionally
    limited by the centre pixel's own radius. This stops blurred
    background from bleeding over sharper content in front of it.
    """
    h, w = radius.shape
    acc_color = np.zeros_like(color)
    acc_weight = np.zeros((h, w), dtype=np.float32)
    acc_cover = np.zeros((h, w), dtype=np.float32)
    max_radius = np.zeros((h, w), dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w]

    for ox, oy in offsets:
        dist = float(np.hypot(ox, oy))
        sx = np.clip(xx + ox, 0, w - 1)
        sy = np.clip(yy + oy, 0, h - 1)
        tap_radius = radius[sy, sx]
        # Soft coverage test: 1 when the tap's CoC disk covers this pixel.
        if center_radius is not None:
            reach = np.minimum(tap_radius, center_radius + softness)
        else:
            reach = tap_radius
        cover = np.clip(reach - dist + softness, 0.0, 1.0)
        if not cover.any():
            continue
        weight = cover * tap_boost[sy, sx]
        acc_color += weight[..., None] * color[sy, sx]
        acc_weight += weight
        acc_cover += cover
        max_radius = np.maximum(max_radius, tap_radius * (cover > 0))
    return acc_color, acc_weight, acc_cover, max_radius


def apply_dof(
    color: np.ndarray,
    depth: np.ndarray,
    lens: LensSettings,
    settings: DofSettings | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Apply depth of field. Returns (blurred colour, signed CoC map).

    ``color`` is HxWx3 linear RGB (highlights may exceed 1.0); ``depth``
    is HxW in metres.
    """
    settings = settings or DofSettings()
    color = np.asarray(color, dtype=np.float32)
    signed = signed_coc(depth, lens)
    near_radius, far_radius = split_fields(signed)

    support = int(np.ceil(max(lens.max_coc_near, lens.max_coc_far)))
    offsets = bokeh_kernel(
        support, settings.num_samples, settings.blades, settings.blade_rotation
    )
    boost = _highlight_weights(color, settings)

    far_color, far_weight, _, _ = _gather_field(
        color, far_radius, offsets, boost, settings.edge_softness,
        center_radius=far_radius,
    )
    near_color, near_weight, near_cover, near_max = _gather_field(
        color, near_radius, offsets, boost, settings.edge_softness
    )

    out = np.where(
        far_weight[..., None] > 1e-6,
        far_color / np.maximum(far_weight[..., None], 1e-6),
        color,
    )

    # Composite the near field over the far field. Expected coverage is
    # the number of kernel taps falling inside the strongest foreground
    # disk seen, so faint foreground blur stays translucent instead of
    # punching holes, while strong blur becomes fully opaque.
    support_f = max(float(support), 1.0)
    expected = len(offsets) * (near_max / support_f) ** 2
    near_alpha = np.clip(near_cover / np.maximum(expected, 1.0), 0.0, 1.0)
    near_rgb = np.where(
        near_weight[..., None] > 1e-6,
        near_color / np.maximum(near_weight[..., None], 1e-6),
        out,
    )
    out = near_rgb * near_alpha[..., None] + out * (1.0 - near_alpha[..., None])
    return out.astype(np.float32), signed
