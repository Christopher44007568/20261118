from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

from .geometry import Point, bounds, polygon_area, polygon_distance
from .packer import PackResult, Placement


def point_to_dict(point: Point) -> dict[str, float]:
    return {"x": point.x, "y": point.y}


def placement_to_dict(placement: Placement) -> dict[str, object]:
    min_x, min_y, max_x, max_y = bounds(placement.points)
    return {
        "id": placement.island.id,
        "kind": placement.island.kind,
        "originalUv": [point_to_dict(point) for point in placement.island.original_uv],
        "offset": point_to_dict(placement.offset),
        "rotation": placement.total_rotation,
        "extraRotation": placement.extra_rotation,
        "scale": placement.scale,
        "packedBounds": {
            "minX": min_x,
            "minY": min_y,
            "maxX": max_x,
            "maxY": max_y,
            "width": max_x - min_x,
            "height": max_y - min_y,
        },
        "packedUv": [point_to_dict(point) for point in placement.points],
    }


def build_mapping(result: PackResult, pixel_size: int = 1024) -> dict[str, object]:
    total_area = sum(polygon_area(placement.points) for placement in result.placements)
    return {
        "atlas": {
            "coordinateSpace": "normalized",
            "width": result.atlas_size,
            "height": result.atlas_size,
            "pixelSize": pixel_size,
            "margin": result.margin,
            "marginPixels": result.margin * pixel_size,
            "globalScale": result.scale,
            "formula": {
                "forward": "R(rotation) * (scale * originalUv) + offset",
                "inverse": "R(-rotation) * (packedUv - offset) / scale",
            },
        },
        "islands": [placement_to_dict(placement) for placement in result.placements],
        "metrics": utilization_by_kind(result, total_area),
    }


def write_json(mapping: dict[str, object], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")


def utilization_by_kind(result: PackResult, total_area: float | None = None) -> dict[str, object]:
    if total_area is None:
        total_area = sum(polygon_area(placement.points) for placement in result.placements)

    grouped: dict[str, dict[str, float | int]] = defaultdict(
        lambda: {"count": 0, "area": 0.0, "boundsArea": 0.0}
    )
    for placement in result.placements:
        item = grouped[placement.island.kind]
        item["count"] += 1
        item["area"] += polygon_area(placement.points)
        min_x, min_y, max_x, max_y = bounds(placement.points)
        item["boundsArea"] += (max_x - min_x) * (max_y - min_y)

    atlas_area = result.atlas_size * result.atlas_size
    return {
        "atlasArea": atlas_area,
        "polygonArea": total_area,
        "polygonUtilization": total_area / atlas_area,
        "minimumBoundaryClearance": minimum_boundary_clearance(result),
        "minimumIslandGap": minimum_island_gap(result),
        "byKind": {
            kind: {
                "count": values["count"],
                "polygonArea": values["area"],
                "polygonUtilization": values["area"] / atlas_area,
                "tightBoundsArea": values["boundsArea"],
                "tightBoundsUtilization": values["boundsArea"] / atlas_area,
            }
            for kind, values in sorted(grouped.items())
        },
    }


def minimum_boundary_clearance(result: PackResult) -> float:
    clearances: list[float] = []
    for placement in result.placements:
        min_x, min_y, max_x, max_y = bounds(placement.points)
        clearances.extend(
            [min_x, min_y, result.atlas_size - max_x, result.atlas_size - max_y]
        )
    return min(clearances)


def minimum_island_gap(result: PackResult) -> float:
    gaps = [
        polygon_distance(first.points, second.points)
        for index, first in enumerate(result.placements)
        for second in result.placements[index + 1 :]
    ]
    return min(gaps) if gaps else math.inf


def write_metrics_csv(rows: list[dict[str, object]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def metrics_row(mapping: dict[str, object]) -> dict[str, object]:
    atlas = mapping["atlas"]
    metrics = mapping["metrics"]
    return {
        "margin": atlas["margin"],
        "marginPixels": round(atlas["marginPixels"], 3),
        "globalScale": round(atlas["globalScale"], 9),
        "polygonUtilization": round(metrics["polygonUtilization"], 6),
        "minimumIslandGap": round(metrics["minimumIslandGap"], 9),
        "minimumBoundaryClearance": round(metrics["minimumBoundaryClearance"], 9),
    }
