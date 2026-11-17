"""Procedural test meshes."""

from __future__ import annotations

from .gpu import Mesh


def make_cube(name: str, size: float = 1.0) -> Mesh:
    s = size / 2.0
    verts = [
        (x, y, z)
        for x in (-s, s)
        for y in (-s, s)
        for z in (-s, s)
    ]
    # index: x*4 + y*2 + z with x,y,z in {0,1}
    tris = [
        (0, 1, 3), (0, 3, 2),  # x-
        (4, 6, 7), (4, 7, 5),  # x+
        (0, 4, 5), (0, 5, 1),  # y-
        (2, 3, 7), (2, 7, 6),  # y+
        (0, 2, 6), (0, 6, 4),  # z-
        (1, 5, 7), (1, 7, 3),  # z+
    ]
    return Mesh(name, verts, tris)


def make_pyramid(name: str, size: float = 1.0, height: float = 1.0) -> Mesh:
    s = size / 2.0
    verts = [
        (-s, 0.0, -s), (s, 0.0, -s), (s, 0.0, s), (-s, 0.0, s),
        (0.0, height, 0.0),
    ]
    tris = [
        (0, 2, 1), (0, 3, 2),
        (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4),
    ]
    return Mesh(name, verts, tris)
