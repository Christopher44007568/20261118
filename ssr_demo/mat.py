"""Minimal row-vector math helpers used by the rasterizer and SSR.

Points are numpy arrays of shape (..., 3). Transform matrices are 4x4 and
follow the column-vector convention: ``p_clip = P @ V @ M @ [x,y,z,1]``.
"""

from __future__ import annotations

import numpy as np


def normalize(v: np.ndarray, axis: int = -1, eps: float = 1e-12) -> np.ndarray:
    v = np.asarray(v, dtype=np.float64)
    norm = np.linalg.norm(v, axis=axis, keepdims=True)
    return v / np.maximum(norm, eps)


def perspective(fov_y_rad: float, aspect: float, z_near: float, z_far: float) -> np.ndarray:
    f = 1.0 / np.tan(fov_y_rad * 0.5)
    p = np.zeros((4, 4), dtype=np.float64)
    p[0, 0] = f / aspect
    p[1, 1] = f
    p[2, 2] = (z_far + z_near) / (z_near - z_far)
    p[2, 3] = (2.0 * z_far * z_near) / (z_near - z_far)
    p[3, 2] = -1.0
    return p


def look_at(eye: np.ndarray, target: np.ndarray, up: np.ndarray) -> np.ndarray:
    eye = np.asarray(eye, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    up = np.asarray(up, dtype=np.float64)
    f = normalize(target - eye)
    s = normalize(np.cross(f, up))
    u = np.cross(s, f)
    view = np.eye(4, dtype=np.float64)
    view[0, :3] = s
    view[1, :3] = u
    view[2, :3] = -f
    view[:3, 3] = -np.stack([s, u, -f]) @ eye
    return view


def translate(tx: float, ty: float, tz: float) -> np.ndarray:
    m = np.eye(4, dtype=np.float64)
    m[:3, 3] = (tx, ty, tz)
    return m


def scale(sx: float, sy: float, sz: float) -> np.ndarray:
    return np.diag([sx, sy, sz, 1.0]).astype(np.float64)


def transform_points(m: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Apply a 4x4 matrix to (N,3) points, dividing by w."""
    points = np.asarray(points, dtype=np.float64)
    homog = np.concatenate([points, np.ones((points.shape[0], 1))], axis=1)
    clipped = homog @ m.T
    return clipped[:, :3] / clipped[:, 3:4]


def transform_directions(m: np.ndarray, dirs: np.ndarray) -> np.ndarray:
    """Apply the upper 3x3 (rotation/scale only) part of a matrix."""
    return dirs @ m[:3, :3].T
