"""程序化场景：多栋大型建筑与散布其后的小型物体。"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np


@dataclass
class Mesh:
    name: str
    vertices: np.ndarray  # (N,6): pos.xyz + normal.xyz
    indices: np.ndarray   # (M,3)


def _box_mesh(name: str, hx: float, hy: float, hz: float) -> Mesh:
    """以原点为中心生成盒体，外法线朝外，逆时针为正面（GL 默认 GL_CCW）。"""
    extents = (hx, hy, hz)
    faces = [
        ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
        ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
        ((1, 0, 0), [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)]),
        ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)]),
        ((0, 1, 0), [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)]),
        ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)]),
    ]
    verts, indices = [], []
    for normal, corners in faces:
        base = len(verts)
        for corner in corners:
            p = [0.0, 0.0, 0.0]
            for axis in range(3):
                p[axis] = corner[axis] * extents[axis]
            verts.append(p + [float(normal[0]), float(normal[1]), float(normal[2])])
        indices += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
    return Mesh(name, np.array(verts, dtype="f4"), np.array(indices, dtype="i4"))


def _cylinder_mesh(name: str, radius: float, half_h: float, segments: int = 14) -> Mesh:
    verts, indices = [], []

    def add(p, n):
        verts.append([p[0], p[1], p[2], n[0], n[1], n[2]])

    for i in range(segments):
        a0 = 2.0 * math.pi * i / segments
        a1 = 2.0 * math.pi * (i + 1) / segments
        n0 = (math.cos(a0), 0.0, math.sin(a0))
        n1 = (math.cos(a1), 0.0, math.sin(a1))
        b0, b1 = (radius * n0[0], -half_h, radius * n0[2]), \
                 (radius * n1[0], -half_h, radius * n1[2])
        t0, t1 = (radius * n0[0], half_h, radius * n0[2]), \
                 (radius * n1[0], half_h, radius * n1[2])
        # 侧面：从外侧看逆时针。
        base = len(verts)
        add(b0, n0); add(t0, n0); add(t1, n1); add(b1, n1)
        indices += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
        # 顶盖（法线 +y），从上方看逆时针。
        top = len(verts)
        add((0.0, half_h, 0.0), (0, 1, 0))
        add(t1, (0, 1, 0)); add(t0, (0, 1, 0))
        indices.append((top, top + 1, top + 2))
        # 底盖（法线 -y），从下方看逆时针。
        bot = len(verts)
        add((0.0, -half_h, 0.0), (0, -1, 0))
        add(b0, (0, -1, 0)); add(b1, (0, -1, 0))
        indices.append((bot, bot + 1, bot + 2))
    return Mesh(name, np.array(verts, dtype="f4"), np.array(indices, dtype="i4"))


@dataclass
class Object:
    name: str
    mesh: str                 # "box" 或 "cylinder"
    center: np.ndarray        # 世界坐标中心
    half_extents: np.ndarray  # 包围盒半尺寸
    color: np.ndarray
    model: np.ndarray = field(default_factory=lambda: np.identity(4, dtype="f4"))


def _model_matrix(center: np.ndarray, scale: np.ndarray) -> np.ndarray:
    # 列主序等价的 T * S：平移放在最后一列，不受缩放影响。
    m = np.identity(4, dtype="f4")
    m[0, 0], m[1, 1], m[2, 2] = scale
    m[0, 3], m[1, 3], m[2, 3] = center
    return np.ascontiguousarray(m, dtype="f4")


def build_scene(rng_seed: int = 20261118) -> dict:
    rng = np.random.default_rng(rng_seed)
    meshes = {
        "box": _box_mesh("box", 1.0, 1.0, 1.0),
        "cylinder": _cylinder_mesh("cylinder", 1.0, 1.0),
        "building": _box_mesh("building", 1.0, 1.0, 1.0),
        "ground": _box_mesh("ground", 1.0, 1.0, 1.0),
    }
    buildings, targets = [], []

    # 4 x 3 网格的大建筑，建筑之间留出可穿行的走廊。
    grid_x, grid_z = [-27.0, -9.0, 9.0, 27.0], [-18.0, 0.0, 18.0]
    heights = [18.0, 14.0, 22.0, 12.0, 16.0, 20.0, 13.0, 17.0, 24.0, 15.0, 19.0, 11.0]
    h = 0
    for gx in grid_x:
        for gz in grid_z:
            sx, sz = 6.0 + rng.uniform(-0.6, 0.6), 6.0 + rng.uniform(-0.6, 0.6)
            sy = heights[h]
            h += 1
            center = np.array([gx, sy / 2.0, gz], dtype="f4")
            scale = np.array([sx / 2.0, sy / 2.0, sz / 2.0], dtype="f4")
            color = np.array([0.42, 0.48, 0.58], dtype="f4") + rng.uniform(-0.05, 0.05, 3)
            buildings.append(Object(f"building_{h}", "building", center, scale,
                                    np.clip(color, 0, 1), _model_matrix(center, scale)))

    # 在建筑前后/之间散布大量小物体；部分会被建筑完全遮挡。
    building_boxes = [(b.center, b.half_extents) for b in buildings]

    def hits_building(center, half) -> bool:
        for bc, bh in building_boxes:
            if all(abs(center[k] - bc[k]) < half[k] + bh[k] + 0.6 for k in range(3)):
                return True
        return False

    placed = []
    i = 0
    while len(placed) < 96 and i < 600:
        i += 1
        mesh = "cylinder" if i % 2 else "box"
        x = rng.uniform(-42.0, 42.0)
        z = rng.uniform(-30.0, 30.0)
        size = rng.uniform(0.8, 1.7)
        full_h = size * rng.uniform(1.6, 3.2)
        center = np.array([x, full_h / 2.0, z], dtype="f4")
        half = np.array([size, full_h / 2.0, size], dtype="f4")
        if hits_building(center, half):
            continue
        if any(all(abs(center[k] - pc[k]) < half[k] + ph[k]
                   for k in range(3)) for pc, ph in placed):
            continue
        hue = rng.uniform(0.02, 0.12)
        color = np.array([
            0.55 + 0.45 * math.sin(hue * 6.28),
            0.35 + 0.3 * rng.random(),
            0.25 + 0.45 * rng.random(),
        ], dtype="f4")
        targets.append(Object(f"target_{len(targets):03d}", mesh, center, half,
                              color, _model_matrix(center, half)))
        placed.append((center, half))

    ground = Object(
        "ground", "ground", np.array([0.0, -0.25, 0.0], dtype="f4"),
        np.array([80.0, 0.25, 60.0], dtype="f4"), np.array([0.22, 0.26, 0.22], dtype="f4"),
        _model_matrix(np.array([0.0, -0.25, 0.0], dtype="f4"),
                      np.array([80.0, 0.25, 60.0], dtype="f4")),
    )
    return {"meshes": meshes, "buildings": buildings, "targets": targets, "ground": ground}
