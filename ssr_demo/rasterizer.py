"""Software z-buffer rasterizer that fills a deferred G-buffer.

The rasterizer is fully vectorized with numpy: each triangle is clipped to
its screen bounding box and processed with barycentric edge functions.
Depth keeps OpenGL-style negative view-space z, so ``linear_depth = -z_view``.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import mat as m
from .mat import transform_directions, transform_points
from .meshes import Mesh


@dataclass
class Material:
    name: str
    albedo: tuple[float, float, float]
    metallic: float
    roughness: float


@dataclass
class RenderObject:
    mesh: Mesh
    model: np.ndarray
    material: Material


@dataclass
class GBuffer:
    width: int
    height: int
    depth: np.ndarray  # (H, W) linear depth, 0 where the background shows
    view_pos: np.ndarray  # (H, W, 3) camera-space position
    view_normal: np.ndarray  # (H, W, 3) camera-space unit normal
    albedo: np.ndarray  # (H, W, 3) base colour
    metallic: np.ndarray  # (H, W)
    roughness: np.ndarray  # (H, W)
    material_id: np.ndarray  # (H, W) int, -1 for background
    inv_proj: np.ndarray  # inverse projection matrix

    @property
    def uv(self) -> np.ndarray:
        u = (np.arange(self.width, dtype=np.float64) + 0.5) / self.width
        v = (np.arange(self.height, dtype=np.float64) + 0.5) / self.height
        return np.stack(np.meshgrid(u, v), axis=-1)


def rasterize(
    objects: list[RenderObject],
    width: int,
    height: int,
    proj: np.ndarray,
    view: np.ndarray,
) -> GBuffer:
    view_proj = proj @ view
    depth = np.zeros((height, width), dtype=np.float64)
    view_pos = np.zeros((height, width, 3), dtype=np.float64)
    view_normal = np.zeros((height, width, 3), dtype=np.float64)
    albedo = np.zeros((height, width, 3), dtype=np.float64)
    metallic = np.zeros((height, width), dtype=np.float64)
    roughness = np.ones((height, width), dtype=np.float64)
    material_id = np.full((height, width), -1, dtype=np.int64)

    for object_index, obj in enumerate(objects):
        normal_matrix = view @ obj.model
        world_pos = transform_points(obj.model, obj.mesh.vertices)
        cam_pos = transform_points(view, world_pos)
        clip = np.concatenate([cam_pos, np.ones((len(cam_pos), 1))], axis=1) @ proj.T
        cam_normals = m.normalize(transform_directions(normal_matrix, obj.mesh.normals))
        tris = obj.mesh.triangles

        for tri in tris:
            clipped = _clip_near_plane(clip[tri], cam_pos[tri], cam_normals[tri])
            for clip_tri, pos_tri, normal_tri in clipped:
                _rasterize_triangle(
                    clip_tri, pos_tri, normal_tri, obj, object_index, width,
                    height, depth, view_pos, view_normal, albedo, metallic,
                    roughness, material_id,
                )

    return GBuffer(
        width, height, depth, view_pos, view_normal, albedo, metallic,
        roughness, material_id, np.linalg.inv(proj),
    )


def _clip_near_plane(
    clip_tri: np.ndarray,
    pos_tri: np.ndarray,
    normal_tri: np.ndarray,
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Sutherland-Hodgman clip against the camera near plane (clip w = eps).

    Without this, a triangle with any corner behind the camera projects to
    garbage and the ground plane would vanish from the G-buffer.
    """
    eps = 1e-4
    out_clip: list[np.ndarray] = []
    out_pos: list[np.ndarray] = []
    out_normal: list[np.ndarray] = []
    for i in range(3):
        cur, nxt = clip_tri[i], clip_tri[(i + 1) % 3]
        cur_in, nxt_in = cur[3] > eps, nxt[3] > eps
        if cur_in:
            out_clip.append(cur)
            out_pos.append(pos_tri[i])
            out_normal.append(normal_tri[i])
        if cur_in != nxt_in:
            t = (eps - cur[3]) / (nxt[3] - cur[3])
            out_clip.append(cur + (nxt - cur) * t)
            out_pos.append(pos_tri[i] + (pos_tri[(i + 1) % 3] - pos_tri[i]) * t)
            out_normal.append(
                normal_tri[i] + (normal_tri[(i + 1) % 3] - normal_tri[i]) * t)
    if len(out_clip) < 3:
        return []
    pieces = []
    for k in range(1, len(out_clip) - 1):
        idx = (0, k, k + 1)
        c = np.stack([out_clip[j] for j in idx])
        p = np.stack([out_pos[j] for j in idx])
        n = np.stack([out_normal[j] for j in idx])
        pieces.append((c, p, n))
    return pieces


def _rasterize_triangle(
    clip_tri: np.ndarray,
    pos_tri: np.ndarray,
    normal_tri: np.ndarray,
    obj: RenderObject,
    object_index: int,
    width: int,
    height: int,
    depth: np.ndarray,
    view_pos: np.ndarray,
    view_normal: np.ndarray,
    albedo: np.ndarray,
    metallic: np.ndarray,
    roughness: np.ndarray,
    material_id: np.ndarray,
) -> None:
    c0, c1, c2 = clip_tri
    # Back-face / near-plane culling: everything must be in front of camera.
    if min(c0[3], c1[3], c2[3]) <= 1e-6:
        return
    ndc = np.stack([c0[:3] / c0[3], c1[:3] / c1[3], c2[:3] / c2[3]])
    sx = (ndc[:, 0] * 0.5 + 0.5) * width
    sy = (1.0 - (ndc[:, 1] * 0.5 + 0.5)) * height

    x_min = max(int(np.floor(min(sx))), 0)
    x_max = min(int(np.ceil(max(sx))), width - 1)
    y_min = max(int(np.floor(min(sy))), 0)
    y_max = min(int(np.ceil(max(sy))), height - 1)
    if x_min > x_max or y_min > y_max:
        return

    px, py = np.meshgrid(
        np.arange(x_min, x_max + 1) + 0.5,
        np.arange(y_min, y_max + 1) + 0.5,
    )
    area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sy[1] - sy[0]) * (sx[2] - sx[0])
    if abs(area) < 1e-10:
        return
    w0 = ((sx[1] - px) * (sy[2] - py) - (sy[1] - py) * (sx[2] - px)) / area
    w1 = ((sx[2] - px) * (sy[0] - py) - (sy[2] - py) * (sx[0] - px)) / area
    w2 = 1.0 - w0 - w1
    inside = (w0 >= 0.0) & (w1 >= 0.0) & (w2 >= 0.0)
    if not np.any(inside):
        return

    # Perspective-correct interpolation via 1/w weights.
    inv_w = 1.0 / clip_tri[:, 3]
    bary_w = np.stack([w0, w1, w2], axis=-1) * inv_w[np.newaxis, np.newaxis, :]
    bary_w /= bary_w.sum(axis=-1, keepdims=True)

    lin_depth = -(bary_w @ pos_tri[:, 2])
    ys, xs = np.nonzero(inside)
    for yy, xx in zip(ys + y_min, xs + x_min):
        local_y, local_x = yy - y_min, xx - x_min
        if lin_depth[local_y, local_x] <= depth[yy, xx]:
            continue
        b = bary_w[local_y, local_x]
        depth[yy, xx] = lin_depth[local_y, local_x]
        view_pos[yy, xx] = b @ pos_tri
        normal = b @ normal_tri
        view_normal[yy, xx] = normal / max(np.linalg.norm(normal), 1e-12)
        albedo[yy, xx] = obj.material.albedo
        metallic[yy, xx] = obj.material.metallic
        roughness[yy, xx] = obj.material.roughness
        material_id[yy, xx] = object_index
