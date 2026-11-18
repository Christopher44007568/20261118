"""The three required SSR test scenarios."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import mat as m
from .meshes import box, cylinder, ground_plane
from .rasterizer import Material, RenderObject


@dataclass
class Camera:
    eye: np.ndarray
    target: np.ndarray


def _scene_common() -> list[RenderObject]:
    ground_mat = Material("polished-floor", (0.32, 0.34, 0.38), 0.95, 0.08)
    objects = [
        RenderObject(ground_plane(80.0), m.translate(0, 0, 0), ground_mat),
        # Coloured "hero" boxes whose screen colours should appear in
        # reflections of the floor and the pillars.
        RenderObject(box(1.4, 1.4, 1.4), m.translate(4.2, 0.7, 1.5),
                     Material("crate-red", (0.85, 0.22, 0.16), 0.1, 0.55)),
        RenderObject(box(1.1, 2.2, 1.1), m.translate(-4.6, 1.1, -2.2),
                     Material("crate-blue", (0.18, 0.35, 0.9), 0.2, 0.45)),
        RenderObject(box(1.8, 0.9, 1.2), m.translate(0.6, 0.45, 5.4),
                     Material("crate-gold", (0.95, 0.72, 0.2), 1.0, 0.35)),
        # Foreground occluders: these sit between the reflective floor and
        # the objects whose reflection would appear behind them, so rays
        # that reach their far side must be rejected as occluded.
        RenderObject(box(2.6, 2.4, 1.0), m.translate(-2.4, 1.2, 3.4),
                     Material("foreground-block", (0.5, 0.24, 0.55), 0.1, 0.6)),
        RenderObject(box(1.0, 3.2, 1.0), m.translate(3.4, 1.6, 3.0),
                     Material("foreground-tower", (0.2, 0.55, 0.45), 0.2, 0.5)),
    ]
    return objects


def build_scenario(name: str) -> tuple[list[RenderObject], Camera]:
    if name == "slender_pillars":
        objects = _scene_common()
        # Five tall, thin cylinders: grazing-angle reflections and narrow
        # screen footprints that stress the ray marcher.
        for i, x in enumerate(np.linspace(-6.0, 6.0, 5)):
            objects.append(RenderObject(
                cylinder(0.16, 7.0, segments=20),
                m.translate(x, 0.0, -3.5 - (i % 2) * 1.2),
                Material("pillar-steel", (0.62, 0.66, 0.72), 1.0, 0.12),
            ))
        camera = Camera(np.array([0.0, 3.2, 12.5]), np.array([0.0, 2.2, -2.0]))

    elif name == "rough_metal":
        objects = _scene_common()
        # Replace the polished floor with a rough metallic one and add
        # rough metal blocks at several depths.
        objects[0] = RenderObject(
            ground_plane(80.0), m.translate(0, 0, 0),
            Material("rough-floor", (0.36, 0.37, 0.4), 1.0, 0.62))
        objects.append(RenderObject(
            box(2.4, 1.8, 2.4), m.translate(-1.2, 0.9, 1.0),
            Material("rough-block", (0.55, 0.57, 0.62), 1.0, 0.72)))
        objects.append(RenderObject(
            cylinder(0.55, 3.4, segments=24), m.translate(3.0, 0.0, -1.4),
            Material("rough-column", (0.7, 0.6, 0.45), 1.0, 0.55)))
        camera = Camera(np.array([0.0, 3.0, 11.0]), np.array([0.0, 1.6, 0.0]))

    elif name == "fast_camera":
        objects = _scene_common()
        for i, x in enumerate(np.linspace(-5.0, 5.0, 4)):
            objects.append(RenderObject(
                cylinder(0.2, 5.5, segments=18),
                m.translate(x, 0.0, -2.8),
                Material("pillar-steel", (0.62, 0.66, 0.72), 1.0, 0.14),
            ))
        # A fast lateral sweep: three viewpoints across one frame interval.
        camera = Camera(np.array([-7.0, 3.0, 10.5]), np.array([0.0, 2.0, -1.0]))
    else:
        raise KeyError(name)
    return objects, camera


def fast_camera_views() -> list[Camera]:
    """Three eye positions sampled during one fast horizontal camera move."""
    return [
        Camera(np.array([-7.0, 3.0, 10.5]), np.array([-2.0, 2.0, -1.0])),
        Camera(np.array([0.0, 3.0, 10.5]), np.array([0.0, 2.0, -1.0])),
        Camera(np.array([7.0, 3.0, 10.5]), np.array([2.0, 2.0, -1.0])),
    ]


SCENARIO_NAMES = ["slender_pillars", "rough_metal", "fast_camera"]
