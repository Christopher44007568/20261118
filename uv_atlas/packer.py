from __future__ import annotations

import math
from dataclasses import dataclass

from .geometry import (
    EPS,
    Point,
    bounds,
    polygon_distance,
    transform_xy,
)
from .islands import Island


@dataclass(frozen=True)
class Placement:
    island: Island
    scale: float
    extra_rotation: float
    total_rotation: float
    offset: Point
    points: list[Point]


@dataclass
class PackResult:
    placements: list[Placement]
    scale: float
    margin: float
    atlas_size: float


def transformed_polygon(
    island: Island,
    scale: float,
    extra_rotation: float,
    offset: Point = Point(0.0, 0.0),
) -> list[Point]:
    total_rotation = island.source_rotation + extra_rotation
    return [
        transform_xy(point, scale, total_rotation, offset)
        for point in island.original_uv
    ]


def rotation_candidates(island: Island, angle_step: float = math.pi / 12.0) -> list[float]:
    if island.kind == "circle":
        return [0.0]
    count = max(1, int(round(2.0 * math.pi / angle_step)))
    return [2.0 * math.pi * index / count for index in range(count)]


def pack_at_scale(
    islands: list[Island],
    scale: float,
    margin: float,
    atlas_size: float = 1.0,
) -> list[Placement] | None:
    placements: list[Placement] = []
    ordered = sorted(islands, key=lambda island: island.area, reverse=True)

    for island in ordered:
        placement = place_island(island, placements, scale, margin, atlas_size)
        if placement is None:
            return None
        placements.append(placement)

    return placements


def place_island(
    island: Island,
    placements: list[Placement],
    scale: float,
    margin: float,
    atlas_size: float,
) -> Placement | None:
    best: Placement | None = None
    best_key: tuple[float, float, float] | None = None

    for extra_rotation in rotation_candidates(island):
        local_points = transformed_polygon(island, scale, extra_rotation)
        min_x, min_y, max_x, max_y = bounds(local_points)
        width = max_x - min_x
        height = max_y - min_y
        if width + 2.0 * margin > atlas_size + EPS or height + 2.0 * margin > atlas_size + EPS:
            continue

        x_candidates = candidate_coordinates(placements, margin, atlas_size - margin - width, True)
        y_candidates = candidate_coordinates(placements, margin, atlas_size - margin - height, False)

        for candidate_y in y_candidates:
            for candidate_x in x_candidates:
                offset = Point(candidate_x - min_x, candidate_y - min_y)
                points = [point + offset for point in local_points]
                if not inside_atlas(points, margin, atlas_size):
                    continue
                if has_collision(points, placements, margin):
                    continue

                key = (candidate_y, candidate_x, extra_rotation)
                if best_key is None or key < best_key:
                    best_key = key
                    best = Placement(
                        island,
                        scale,
                        extra_rotation,
                        island.source_rotation + extra_rotation,
                        offset,
                        points,
                    )

    return best


def candidate_coordinates(
    placements: list[Placement],
    margin: float,
    maximum: float,
    horizontal: bool,
) -> list[float]:
    values = {margin}
    for placement in placements:
        min_x, min_y, max_x, max_y = bounds(placement.points)
        values.add((max_x if horizontal else max_y) + margin)
    return sorted(value for value in values if value <= maximum + EPS)


def inside_atlas(points: list[Point], margin: float, atlas_size: float) -> bool:
    min_x, min_y, max_x, max_y = bounds(points)
    return (
        min_x >= margin - EPS
        and min_y >= margin - EPS
        and max_x <= atlas_size - margin + EPS
        and max_y <= atlas_size - margin + EPS
    )


def has_collision(points: list[Point], placements: list[Placement], margin: float) -> bool:
    min_x, min_y, max_x, max_y = bounds(points)
    for placement in placements:
        other_min_x, other_min_y, other_max_x, other_max_y = bounds(placement.points)
        axis_separated_by_margin = (
            min_x > other_max_x + margin - EPS
            or max_x < other_min_x - margin + EPS
            or min_y > other_max_y + margin - EPS
            or max_y < other_min_y - margin + EPS
        )
        if axis_separated_by_margin:
            continue
        if polygon_distance(points, placement.points) < margin - EPS:
            return True
    return False


def find_packing(
    islands: list[Island],
    margin: float,
    atlas_size: float = 1.0,
    upper_scale: float = 1.0,
) -> PackResult:
    if margin * 2.0 >= atlas_size:
        raise ValueError("margin is too large for the requested islands and atlas")

    if pack_at_scale(islands, upper_scale, margin, atlas_size) is None:
        low = upper_scale * 0.5
        while pack_at_scale(islands, low, margin, atlas_size) is None:
            low *= 0.5
            if low < upper_scale * 1e-9:
                raise ValueError("margin is too large for the requested islands and atlas")
        high = upper_scale
    else:
        return PackResult(
            pack_at_scale(islands, upper_scale, margin, atlas_size) or [],
            upper_scale,
            margin,
            atlas_size,
        )

    for _ in range(16):
        middle = (low + high) * 0.5
        placements = pack_at_scale(islands, middle, margin, atlas_size)
        if placements is None:
            high = middle
        else:
            low = middle

    scale = low
    placements = pack_at_scale(islands, scale, margin, atlas_size)
    if placements is None:
        raise RuntimeError("packing failed after binary search")
    return PackResult(placements, scale, margin, atlas_size)
