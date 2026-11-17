"""Minimal pure-Python 3D math: 4x4 matrices, axis-aligned boxes."""

from __future__ import annotations

import math
from typing import Iterable, List, Sequence, Tuple

Vec3 = Tuple[float, float, float]


class Mat4:
    """Row-major 4x4 matrix stored as a flat tuple of 16 floats."""

    __slots__ = ("m",)

    def __init__(self, m: Sequence[float] | None = None):
        if m is None:
            self.m = (
                1.0, 0.0, 0.0, 0.0,
                0.0, 1.0, 0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 0.0, 1.0,
            )
        else:
            assert len(m) == 16
            self.m = tuple(float(v) for v in m)

    @staticmethod
    def identity() -> "Mat4":
        return Mat4()

    @staticmethod
    def translation(x: float, y: float, z: float) -> "Mat4":
        return Mat4((
            1.0, 0.0, 0.0, x,
            0.0, 1.0, 0.0, y,
            0.0, 0.0, 1.0, z,
            0.0, 0.0, 0.0, 1.0,
        ))

    @staticmethod
    def scale(sx: float, sy: float, sz: float) -> "Mat4":
        return Mat4((
            sx, 0.0, 0.0, 0.0,
            0.0, sy, 0.0, 0.0,
            0.0, 0.0, sz, 0.0,
            0.0, 0.0, 0.0, 1.0,
        ))

    @staticmethod
    def rotation_y(radians: float) -> "Mat4":
        c, s = math.cos(radians), math.sin(radians)
        return Mat4((
            c, 0.0, s, 0.0,
            0.0, 1.0, 0.0, 0.0,
            -s, 0.0, c, 0.0,
            0.0, 0.0, 0.0, 1.0,
        ))

    def __mul__(self, other: "Mat4") -> "Mat4":
        a, b = self.m, other.m
        out = [0.0] * 16
        for row in range(4):
            for col in range(4):
                out[row * 4 + col] = (
                    a[row * 4 + 0] * b[0 * 4 + col]
                    + a[row * 4 + 1] * b[1 * 4 + col]
                    + a[row * 4 + 2] * b[2 * 4 + col]
                    + a[row * 4 + 3] * b[3 * 4 + col]
                )
        return Mat4(out)

    def transform_point(self, p: Vec3) -> Vec3:
        m = self.m
        x, y, z = p
        return (
            m[0] * x + m[1] * y + m[2] * z + m[3],
            m[4] * x + m[5] * y + m[6] * z + m[7],
            m[8] * x + m[9] * y + m[10] * z + m[11],
        )

    def almost_equal(self, other: "Mat4", eps: float = 1e-9) -> bool:
        return all(abs(a - b) <= eps for a, b in zip(self.m, other.m))


class AABB:
    """Axis-aligned bounding box."""

    __slots__ = ("minimum", "maximum")

    def __init__(self, minimum: Vec3, maximum: Vec3):
        self.minimum = minimum
        self.maximum = maximum

    @staticmethod
    def empty() -> "AABB":
        inf = float("inf")
        return AABB((inf, inf, inf), (-inf, -inf, -inf))

    @staticmethod
    def from_points(points: Iterable[Vec3]) -> "AABB":
        box = AABB.empty()
        for p in points:
            box.extend(p)
        return box

    def extend(self, p: Vec3) -> None:
        self.minimum = tuple(min(a, b) for a, b in zip(self.minimum, p))
        self.maximum = tuple(max(a, b) for a, b in zip(self.maximum, p))

    def union(self, other: "AABB") -> "AABB":
        if other.is_empty():
            return self
        if self.is_empty():
            return other
        return AABB(
            tuple(min(a, b) for a, b in zip(self.minimum, other.minimum)),
            tuple(max(a, b) for a, b in zip(self.maximum, other.maximum)),
        )

    def is_empty(self) -> bool:
        return any(lo > hi for lo, hi in zip(self.minimum, self.maximum))

    def almost_equal(self, other: "AABB", eps: float = 1e-9) -> bool:
        if self.is_empty() and other.is_empty():
            return True
        return all(
            abs(a - b) <= eps
            for a, b in zip(self.minimum + self.maximum, other.minimum + other.maximum)
        )

    def corners(self) -> List[Vec3]:
        lo, hi = self.minimum, self.maximum
        return [
            (x, y, z)
            for x in (lo[0], hi[0])
            for y in (lo[1], hi[1])
            for z in (lo[2], hi[2])
        ]
