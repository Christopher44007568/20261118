"""Tiny deterministic software renderer.

Rasterizes the visible meshes of a scene graph with an orthographic
projection and a z-buffer. Used to prove that incremental cache updates
produce pixel-identical output to a full rebuild.
"""

from __future__ import annotations

import hashlib
from typing import List, Tuple

from .graph import Node, SceneGraph

Color = Tuple[int, int, int]

# Deterministic per-node color palette.
_PALETTE: List[Color] = [
    (220, 60, 60), (60, 200, 90), (70, 120, 230), (230, 200, 60),
    (180, 80, 220), (60, 200, 200), (240, 140, 40), (140, 140, 140),
]


class FrameBuffer:
    def __init__(self, width: int, height: int):
        self.width = width
        self.height = height
        self.color = bytearray(width * height * 3)
        self.depth = [float("inf")] * (width * height)

    def put(self, x: int, y: int, z: float, rgb: Color) -> None:
        if not (0 <= x < self.width and 0 <= y < self.height):
            return
        idx = y * self.width + x
        if z < self.depth[idx]:
            self.depth[idx] = z
            self.color[idx * 3: idx * 3 + 3] = bytes(rgb)

    def digest(self) -> str:
        return hashlib.sha256(bytes(self.color)).hexdigest()


def _node_color(node: Node) -> Color:
    h = int(hashlib.sha256(node.name.encode()).hexdigest(), 16)
    return _PALETTE[h % len(_PALETTE)]


def render(graph: SceneGraph, width: int = 96, height: int = 72,
           view_span: float = 24.0) -> FrameBuffer:
    """Orthographic render looking down -Z; x right, y up, centered at origin."""
    fb = FrameBuffer(width, height)
    for node in graph.root.iter_subtree():
        if not _effectively_visible(node) or node.mesh is None:
            continue
        rgb = _node_color(node)
        world_verts = [node.world.transform_point(v) for v in node.mesh.vertices]
        for tri in node.mesh.triangles:
            _rasterize(fb, [world_verts[i] for i in tri], rgb, view_span)
    return fb


def _effectively_visible(node: Node) -> bool:
    while node is not None:
        if not node.visible:
            return False
        node = node.parent
    return True


def _rasterize(fb: FrameBuffer, pts: List[tuple], rgb: Color, span: float) -> None:
    (x0, y0, z0), (x1, y1, z1), (x2, y2, z2) = pts
    sx = fb.width / span
    sy = fb.height / span

    def to_px(x: float, y: float) -> Tuple[float, float]:
        return ((x + span / 2) * sx, (y + span / 2) * sy)

    ax, ay = to_px(x0, y0)
    bx, by = to_px(x1, y1)
    cx, cy = to_px(x2, y2)
    min_x = max(int(min(ax, bx, cx)), 0)
    max_x = min(int(max(ax, bx, cx)) + 1, fb.width - 1)
    min_y = max(int(min(ay, by, cy)), 0)
    max_y = min(int(max(ay, by, cy)) + 1, fb.height - 1)
    area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if abs(area) < 1e-12:
        return
    for py in range(min_y, max_y + 1):
        for px in range(min_x, max_x + 1):
            w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area
            w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area
            w2 = 1.0 - w0 - w1
            if w0 < 0 or w1 < 0 or w2 < 0:
                continue
            z = w0 * z0 + w1 * z1 + w2 * z2
            fb.put(px, py, z, rgb)
