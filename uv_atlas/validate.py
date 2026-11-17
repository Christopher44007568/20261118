from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

from .geometry import (
    EPS,
    Point,
    bounds,
    dot,
    inverse_transform,
    point_in_polygon,
    polygon_distance,
    transform_xy,
)


def read_mapping(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def dict_to_point(data: dict[str, float]) -> Point:
    return Point(float(data["x"]), float(data["y"]))


def random_inside_polygon(
    points: list[Point],
    rng: random.Random,
    maximum_attempts: int = 10000,
) -> Point:
    min_x, min_y, max_x, max_y = bounds(points)
    for _ in range(maximum_attempts):
        candidate = Point(rng.uniform(min_x, max_x), rng.uniform(min_y, max_y))
        if point_in_polygon(candidate, points):
            return candidate
    raise ValueError("could not sample a point inside polygon")


def forward_from_mapping(point: Point, island: dict[str, object]) -> Point:
    return transform_xy(
        point,
        float(island["scale"]),
        float(island["rotation"]),
        dict_to_point(island["offset"]),
    )


def validate_mapping(
    mapping: dict[str, object],
    samples_per_island: int = 8,
    seed: int = 20261118,
) -> dict[str, object]:
    rng = random.Random(seed)
    islands = mapping["islands"]
    atlas = mapping["atlas"]
    atlas_size = float(atlas["width"])
    margin = float(atlas["margin"])
    packed_polygons: list[list[Point]] = []
    sample_records: list[dict[str, object]] = []
    max_inverse_error = 0.0
    max_polygon_reapply_error = 0.0
    sample_outside_failures = 0
    orientation_failures: list[str] = []

    for island in islands:
        original = [dict_to_point(point) for point in island["originalUv"]]
        expected_packed = [dict_to_point(point) for point in island["packedUv"]]
        reapplied = [forward_from_mapping(point, island) for point in original]
        packed_polygons.append(reapplied)

        for expected, actual in zip(expected_packed, reapplied, strict=True):
            max_polygon_reapply_error = max(
                max_polygon_reapply_error,
                math.hypot(expected.x - actual.x, expected.y - actual.y),
            )

        if not orientation_preserved(island):
            orientation_failures.append(str(island["id"]))

        for sample_index in range(samples_per_island):
            source_point = random_inside_polygon(original, rng)
            packed_point = forward_from_mapping(source_point, island)
            if not point_in_polygon(packed_point, reapplied):
                sample_outside_failures += 1
            restored_point = inverse_transform(
                packed_point,
                float(island["scale"]),
                float(island["rotation"]),
                dict_to_point(island["offset"]),
            )
            inverse_error = math.hypot(
                source_point.x - restored_point.x,
                source_point.y - restored_point.y,
            )
            max_inverse_error = max(max_inverse_error, inverse_error)
            sample_records.append(
                {
                    "islandId": island["id"],
                    "sample": sample_index,
                    "source": {"x": source_point.x, "y": source_point.y},
                    "packed": {"x": packed_point.x, "y": packed_point.y},
                    "restored": {"x": restored_point.x, "y": restored_point.y},
                    "inverseError": inverse_error,
                }
            )

    boundary_clearance = minimum_boundary_clearance(packed_polygons, atlas_size)
    minimum_gap = minimum_polygon_gap(packed_polygons)

    return {
        "sampleSeed": seed,
        "samplesPerIsland": samples_per_island,
        "totalSamples": len(sample_records),
        "maxForwardError": max_polygon_reapply_error,
        "maxInverseError": max_inverse_error,
        "maxPolygonReapplyError": max_polygon_reapply_error,
        "sampleOutsideFailures": sample_outside_failures,
        "minimumBoundaryClearance": boundary_clearance,
        "minimumIslandGap": minimum_gap,
        "margin": margin,
        "boundaryPassed": boundary_clearance + EPS >= margin,
        "gapPassed": minimum_gap + EPS >= margin,
        "orientationPassed": not orientation_failures,
        "orientationFailures": orientation_failures,
        "samples": sample_records,
    }


def orientation_preserved(island: dict[str, object]) -> bool:
    scale = float(island["scale"])
    rotation = float(island["rotation"])
    x_axis = transform_xy(Point(1.0, 0.0), scale, rotation, Point(0.0, 0.0))
    y_axis = transform_xy(Point(0.0, 1.0), scale, rotation, Point(0.0, 0.0))
    determinant = x_axis.x * y_axis.y - x_axis.y * y_axis.x
    expected_length = scale
    lengths_ok = (
        abs(math.hypot(x_axis.x, x_axis.y) - expected_length) <= 1e-12
        and abs(math.hypot(y_axis.x, y_axis.y) - expected_length) <= 1e-12
    )
    orthogonal = abs(dot(x_axis, y_axis)) <= 1e-12
    return scale > 0.0 and determinant > 0.0 and lengths_ok and orthogonal


def minimum_boundary_clearance(polygons: list[list[Point]], atlas_size: float) -> float:
    clearances: list[float] = []
    for polygon in polygons:
        min_x, min_y, max_x, max_y = bounds(polygon)
        clearances.extend([min_x, min_y, atlas_size - max_x, atlas_size - max_y])
    return min(clearances)


def minimum_polygon_gap(polygons: list[list[Point]]) -> float:
    gaps = [
        polygon_distance(first, second)
        for index, first in enumerate(polygons)
        for second in polygons[index + 1 :]
    ]
    return min(gaps)


def write_validation_report(report: dict[str, object], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Reapply a UV atlas mapping and verify random samples.")
    parser.add_argument("mapping", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--samples-per-island", type=int, default=8)
    parser.add_argument("--seed", type=int, default=20261118)
    args = parser.parse_args()

    report = validate_mapping(
        read_mapping(args.mapping),
        samples_per_island=args.samples_per_island,
        seed=args.seed,
    )
    write_validation_report(report, args.output)


if __name__ == "__main__":
    main()
