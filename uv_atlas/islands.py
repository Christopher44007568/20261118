from __future__ import annotations

import math
from dataclasses import dataclass, field, replace

from .geometry import Point, polygon_area, rotate


@dataclass(frozen=True)
class Island:
    id: str
    kind: str
    original_uv: list[Point]
    source_rotation: float
    width: float
    height: float
    area: float = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "area", polygon_area(self.original_uv))


def make_rectangle(
    identifier: str,
    width: float,
    height: float,
    source_rotation: float,
) -> Island:
    half_width = width * 0.5
    half_height = height * 0.5
    local = [
        Point(-half_width, -half_height),
        Point(half_width, -half_height),
        Point(half_width, half_height),
        Point(-half_width, half_height),
    ]
    points = [rotate(point, source_rotation) for point in local]
    return Island(identifier, "rectangle", points, source_rotation, width, height)


def make_circle(
    identifier: str,
    radius: float,
    source_rotation: float,
    segments: int = 40,
) -> Island:
    points = [
        rotate(
            Point(
                radius * math.cos(2.0 * math.pi * index / segments),
                radius * math.sin(2.0 * math.pi * index / segments),
            ),
            source_rotation,
        )
        for index in range(segments)
    ]
    return Island(identifier, "circle", points, source_rotation, radius * 2.0, radius * 2.0)


def make_strip(
    identifier: str,
    length: float,
    thickness: float,
    source_rotation: float,
) -> Island:
    return replace(
        make_rectangle(identifier, length, thickness, source_rotation),
        kind="strip",
    )


def generate_islands() -> list[Island]:
    base = [
        make_rectangle("rect_01", 0.34, 0.25, 0.25),
        make_rectangle("rect_02", 0.28, 0.20, -0.65),
        make_rectangle("rect_03", 0.24, 0.22, 1.10),
        make_rectangle("rect_04", 0.20, 0.17, 2.35),
        make_rectangle("rect_05", 0.17, 0.12, -1.40),
        make_circle("circle_01", 0.15, 0.40),
        make_circle("circle_02", 0.12, 1.00),
        make_circle("circle_03", 0.10, -0.70),
        make_circle("circle_04", 0.08, 2.00),
        make_circle("circle_05", 0.065, 0.10),
        make_strip("strip_01", 0.48, 0.045, 0.55),
        make_strip("strip_02", 0.42, 0.040, -0.35),
        make_strip("strip_03", 0.36, 0.035, 1.25),
        make_strip("strip_04", 0.32, 0.030, -1.05),
        make_strip("strip_05", 0.28, 0.025, 2.10),
    ]
    size_factor = 1.15
    return [
        replace(
            island,
            original_uv=[
                Point(point.x * size_factor, point.y * size_factor)
                for point in island.original_uv
            ],
            width=island.width * size_factor,
            height=island.height * size_factor,
        )
        for island in base
    ]
