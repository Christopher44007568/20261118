"""蛇形相机航迹与视图/投影矩阵。"""

from __future__ import annotations

import math

import numpy as np


def perspective(fov_y: float, aspect: float, near: float, far: float) -> np.ndarray:
    f = 1.0 / math.tan(fov_y / 2.0)
    proj = np.zeros((4, 4), dtype="f4")
    proj[0, 0] = f / aspect
    proj[1, 1] = f
    proj[2, 2] = (far + near) / (near - far)
    proj[2, 3] = (2.0 * far * near) / (near - far)
    proj[3, 2] = -1.0
    return proj


def look_at(eye: np.ndarray, target: np.ndarray, up: np.ndarray) -> np.ndarray:
    forward = target - eye
    norm = np.linalg.norm(forward)
    if norm < 1e-6:
        forward = np.array([0.0, 0.0, -1.0], dtype="f4")
    else:
        forward = forward / norm
    right = np.cross(forward, up)
    right_norm = np.linalg.norm(right)
    if right_norm < 1e-6:
        right = np.array([1.0, 0.0, 0.0], dtype="f4")
    else:
        right = right / right_norm
    cam_up = np.cross(right, forward)
    view = np.identity(4, dtype="f4")
    view[0, :3] = right
    view[1, :3] = cam_up
    view[2, :3] = -forward
    view[0, 3] = -np.dot(right, eye)
    view[1, 3] = -np.dot(cam_up, eye)
    view[2, 3] = np.dot(forward, eye)
    return view


# 航迹关键点：在建筑走廊间蛇形往返，高度约 12 米，多次经过建筑正后方。
KEY_POINTS = np.array([
    [-46.0, 12.0, -28.0],
    [-30.0, 12.5, -10.0],
    [-12.0, 13.0, 10.0],
    [6.0, 11.5, -10.0],
    [24.0, 13.0, 10.0],
    [42.0, 12.0, -10.0],
    [26.0, 14.0, -28.0],
    [0.0, 12.0, -8.0],
    [-20.0, 13.0, 12.0],
    [-42.0, 12.0, -6.0],
], dtype="f4")


def _catmull_rom(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray,
                 p3: np.ndarray, t: float) -> np.ndarray:
    t2, t3 = t * t, t * t * t
    return 0.5 * (
        2.0 * p1
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    )


def camera_at(frame: int, frame_count: int) -> tuple[np.ndarray, np.ndarray]:
    """返回当前帧的眼点与注视点（含前瞻）。"""
    s = frame / max(frame_count - 1, 1)
    n = len(KEY_POINTS) - 1
    pos = s * n
    i = min(int(pos), n - 1)
    t = pos - i
    p0 = KEY_POINTS[max(i - 1, 0)]
    p1 = KEY_POINTS[i]
    p2 = KEY_POINTS[min(i + 1, n)]
    p3 = KEY_POINTS[min(i + 2, n)]
    eye = _catmull_rom(p0, p1, p2, p3, t).astype("f4")
    eye[1] += 0.5 * math.sin(s * math.pi * 4.0)
    # 沿航迹切线方向注视前方约 26 米，仅轻微下压，保持近水平视角。
    eps = 1e-3
    ahead = _catmull_rom(p0, p1, p2, p3, min(t + 0.25, 1.0)).astype("f4")
    behind = _catmull_rom(p0, p1, p2, p3, max(t - 0.25, 0.0)).astype("f4")
    tangent = ahead - behind
    tangent[1] = 0.0
    norm = np.linalg.norm(tangent)
    if norm < eps:
        tangent = np.array([1.0, 0.0, 0.0], dtype="f4")
    else:
        tangent = tangent / norm
    target = eye + tangent * 26.0
    target[1] = eye[1] - 4.0
    return eye, target
