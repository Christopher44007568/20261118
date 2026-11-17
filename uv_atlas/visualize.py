from __future__ import annotations
from html import escape
from pathlib import Path

from .geometry import Point
from .packer import PackResult


COLORS = {
    "rectangle": "#4c78a8",
    "circle": "#59a14f",
    "strip": "#f28e2b",
}


def write_svg(result: PackResult, path: Path, pixel_size: int = 720) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    elements = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{pixel_size}" '
        f'height="{pixel_size}" viewBox="0 0 {result.atlas_size} {result.atlas_size}">',
        '<rect width="1" height="1" fill="#ffffff"/>',
        (
            f'<rect x="{result.margin}" y="{result.margin}" '
            f'width="{result.atlas_size - 2.0 * result.margin:.9f}" '
            f'height="{result.atlas_size - 2.0 * result.margin:.9f}" '
            'fill="none" stroke="#999999" stroke-width="0.003" stroke-dasharray="0.015 0.01"/>'
        ),
    ]

    for placement in result.placements:
        points = " ".join(f"{point.x:.9f},{point.y:.9f}" for point in placement.points)
        color = COLORS.get(placement.island.kind, "#777777")
        elements.append(
            f'<polygon points="{points}" fill="{color}" fill-opacity="0.72" '
            'stroke="#1f1f1f" stroke-width="0.002"/>'
        )
        center = polygon_center(placement.points)
        elements.append(
            f'<text x="{center.x:.9f}" y="{center.y:.9f}" '
            'font-size="0.025" text-anchor="middle" '
            f'dominant-baseline="middle" fill="#111111">{escape(placement.island.id)}</text>'
        )

    elements.append("</svg>")
    path.write_text("\n".join(elements), encoding="utf-8")


def polygon_center(points: list[Point]) -> Point:
    return Point(
        sum(point.x for point in points) / len(points),
        sum(point.y for point in points) / len(points),
    )
