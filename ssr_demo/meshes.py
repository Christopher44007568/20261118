"""Procedural triangle meshes with explicit vertex normals."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Mesh:
    vertices: np.ndarray  # (N, 3) object-space positions
    normals: np.ndarray  # (N, 3) unit vertex normals
    triangles: np.ndarray  # (M, 3) indices into vertices / normals

    def __post_init__(self) -> None:
        self.vertices = np.asarray(self.vertices, dtype=np.float64)
        self.normals = np.asarray(self.normals, dtype=np.float64)
        self.triangles = np.asarray(self.triangles, dtype=np.int64)


def ground_plane(size: float = 60.0) -> Mesh:
    h = size * 0.5
    vertices = np.array(
        [(-h, 0.0, -h), (h, 0.0, -h), (h, 0.0, h), (-h, 0.0, h)],
        dtype=np.float64,
    )
    normals = np.array([(0, 1, 0)] * 4, dtype=np.float64)
    triangles = np.array([(0, 2, 1), (0, 3, 2)], dtype=np.int64)
    return Mesh(vertices, normals, triangles)


def box(width: float, height: float, depth: float) -> Mesh:
    """Axis-aligned box centred at the origin; 24 vertices so each face
    carries flat normals."""
    hx, hy, hz = width * 0.5, height * 0.5, depth * 0.5
    faces = [
        # (normal, four corners in CCW order seen from outside)
        ((1, 0, 0), [(hx, -hy, -hz), (hx, -hy, hz), (hx, hy, hz), (hx, hy, -hz)]),
        ((-1, 0, 0), [(-hx, -hy, hz), (-hx, -hy, -hz), (-hx, hy, -hz), (-hx, hy, hz)]),
        ((0, 1, 0), [(-hx, hy, -hz), (hx, hy, -hz), (hx, hy, hz), (-hx, hy, hz)]),
        ((0, -1, 0), [(-hx, -hy, hz), (hx, -hy, hz), (hx, -hy, -hz), (-hx, -hy, -hz)]),
        ((0, 0, 1), [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]),
        ((0, 0, -1), [(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)]),
    ]
    vertices: list[tuple[float, float, float]] = []
    normals: list[tuple[float, float, float]] = []
    triangles: list[tuple[int, int, int]] = []
    for normal, corners in faces:
        base = len(vertices)
        vertices.extend(corners)
        normals.extend([normal] * 4)
        triangles.extend([(base, base + 1, base + 2), (base, base + 2, base + 3)])
    return Mesh(np.array(vertices), np.array(normals), np.array(triangles))


def cylinder(radius: float, height: float, segments: int = 24) -> Mesh:
    """Thin cylinder standing on y=0, axis on y. Side plus cap fans."""
    angles = np.linspace(0.0, 2.0 * np.pi, segments, endpoint=False)
    ring_x = radius * np.cos(angles)
    ring_z = radius * np.sin(angles)

    vertices: list[list[float]] = []
    normals: list[list[float]] = []
    triangles: list[tuple[int, int, int]] = []

    # Side walls: two rings, normal points radially outward.
    bottom: list[int] = []
    top: list[int] = []
    for i in range(segments):
        n = (np.cos(angles[i]), 0.0, np.sin(angles[i]))
        bottom.append(len(vertices))
        vertices.append([ring_x[i], 0.0, ring_z[i]])
        normals.append(list(n))
        top.append(len(vertices))
        vertices.append([ring_x[i], height, ring_z[i]])
        normals.append(list(n))
    for i in range(segments):
        j = (i + 1) % segments
        triangles.append((bottom[i], bottom[j], top[j]))
        triangles.append((bottom[i], top[j], top[i]))

    # Bottom cap (normal -y) and top cap (normal +y).
    bottom_center = len(vertices)
    vertices.append([0.0, 0.0, 0.0])
    normals.append([0.0, -1.0, 0.0])
    top_center = len(vertices)
    vertices.append([0.0, height, 0.0])
    normals.append([0.0, 1.0, 0.0])
    bottom_ring = list(range(bottom[0], bottom[0] + segments * 2, 2))
    top_ring = list(range(top[0], top[0] + segments * 2, 2))
    for i in range(segments):
        j = (i + 1) % segments
        triangles.append((bottom_center, bottom_ring[j], bottom_ring[i]))
        triangles.append((top_center, top_ring[i], top_ring[j]))

    return Mesh(np.array(vertices), np.array(normals), np.array(triangles))
