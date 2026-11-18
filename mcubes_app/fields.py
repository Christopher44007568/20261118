"""Scalar field functions used to validate the extractor.

Each field returns (field_array, origin, spacing, default_level, level_range).
Inside the surface the field is <= level.
"""
import numpy as np

GRID_N = 64          # samples per axis
LO, HI = -1.6, 1.6   # world extent of the sampling volume


def _grid(n=GRID_N, lo=LO, hi=HI):
    axis = np.linspace(lo, hi, n)
    spacing = (axis[1] - axis[0],) * 3
    x, y, z = np.meshgrid(axis, axis, axis, indexing="ij")
    return (x, y, z), (lo, lo, lo), spacing


def sphere_field(n=GRID_N):
    """Single sphere, radius 1, centred at the origin. Level = SDF (<=0 inside)."""
    (x, y, z), origin, spacing = _grid(n)
    field = np.sqrt(x ** 2 + y ** 2 + z ** 2) - 1.0
    return field, origin, spacing, 0.0, (-0.6, 0.6)


def double_sphere_field(n=GRID_N):
    """Two metaballs that fuse: field = sum r_i^2 / d_i^2, iso ~ 1 (inside >= iso).

    Returned negated so the extractor's `inside = field <= level` convention
    still holds: field = 1 - density, level 0.
    """
    (x, y, z), origin, spacing = _grid(n)
    c1 = (-0.55, 0.0, 0.0)
    c2 = (0.55, 0.0, 0.0)
    r1, r2 = 0.75, 0.55
    d1 = (x - c1[0]) ** 2 + (y - c1[1]) ** 2 + (z - c1[2]) ** 2
    d2 = (x - c2[0]) ** 2 + (y - c2[1]) ** 2 + (z - c2[2]) ** 2
    density = r1 ** 2 / np.maximum(d1, 1e-9) + r2 ** 2 / np.maximum(d2, 1e-9)
    field = 1.0 - density          # <= 0 inside the fused blob
    return field, origin, spacing, 0.0, (-0.8, 0.9)


def plane_cut_field(n=GRID_N):
    """Sphere of radius 1 clipped by the plane x = 0.25 (keeps x >= 0.25 side).

    field = max(sphere_sdf, plane_sdf) -> closed half-ball with a flat cap.
    """
    (x, y, z), origin, spacing = _grid(n)
    sphere = np.sqrt(x ** 2 + y ** 2 + z ** 2) - 1.0
    plane = 0.25 - x               # <= 0 when x >= 0.25
    field = np.maximum(sphere, plane)
    return field, origin, spacing, 0.0, (-0.6, 0.6)


FIELDS = {
    "sphere": ("Sphere", sphere_field),
    "double_sphere": ("Double Sphere (metaball)", double_sphere_field),
    "plane_cut": ("Plane Cut", plane_cut_field),
}


def load_field(name, n=GRID_N):
    label, fn = FIELDS[name]
    field, origin, spacing, level0, level_range = fn(n)
    return label, field, origin, spacing, level0, level_range
