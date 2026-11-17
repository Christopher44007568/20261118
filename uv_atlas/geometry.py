from __future__ import annotations

import math
from dataclasses import dataclass


EPS = 1e-10


@dataclass(frozen=True)
class Point:
    x: float
    y: float

    def __add__(self, other: "Point") -> "Point":
        return Point(self.x + other.x, self.y + other.y)

    def __sub__(self, other: "Point") -> "Point":
        return Point(self.x - other.x, self.y - other.y)

    def __mul__(self, value: float) -> "Point":
        return Point(self.x * value, self.y * value)

    __rmul__ = __mul__


def rotate(point: Point, theta: float) -> Point:
    cosine = math.cos(theta)
    sine = math.sin(theta)
    return Point(
        point.x * cosine - point.y * sine,
        point.x * sine + point.y * cosine,
    )


def transform_xy(point: Point, scale: float, theta: float, offset: Point) -> Point:
    return rotate(point * scale, theta) + offset


def inverse_transform(point: Point, scale: float, theta: float, offset: Point) -> Point:
    local = point - offset
    local = rotate(local, -theta)
    return Point(local.x / scale, local.y / scale)


def bounds(points: list[Point]) -> tuple[float, float, float, float]:
    min_x = min(point.x for point in points)
    min_y = min(point.y for point in points)
    max_x = max(point.x for point in points)
    max_y = max(point.y for point in points)
    return min_x, min_y, max_x, max_y


def polygon_area(points: list[Point]) -> float:
    area = 0.0
    for index, current in enumerate(points):
        following = points[(index + 1) % len(points)]
        area += current.x * following.y - following.x * current.y
    return abs(area) * 0.5


def dot(left: Point, right: Point) -> float:
    return left.x * right.x + left.y * right.y


def cross(left: Point, right: Point) -> float:
    return left.x * right.y - left.y * right.x


def point_to_segment_distance(point: Point, start: Point, end: Point) -> float:
    segment = end - start
    length_squared = dot(segment, segment)
    if length_squared <= EPS:
        return math.hypot(point.x - start.x, point.y - start.y)
    ratio = max(0.0, min(1.0, dot(point - start, segment) / length_squared))
    projection = start + segment * ratio
    return math.hypot(point.x - projection.x, point.y - projection.y)


def polygon_distance(first: list[Point], second: list[Point]) -> float:
    if polygons_overlap(first, second):
        return 0.0
    return min(
        point_to_segment_distance(point, start, end)
        for polygon, other in ((first, second), (second, first))
        for point in polygon
        for start, end in polygon_edges(other)
    )


def polygon_edges(points: list[Point]) -> list[tuple[Point, Point]]:
    return [
        (point, points[(index + 1) % len(points)])
        for index, point in enumerate(points)
    ]


def polygons_overlap(first: list[Point], second: list[Point]) -> bool:
    if point_in_polygon(first[0], second) or point_in_polygon(second[0], first):
        return True
    for start_a, end_a in polygon_edges(first):
        for start_b, end_b in polygon_edges(second):
            if segments_intersect(start_a, end_a, start_b, end_b):
                return True
    return False


def segments_intersect(
    first_start: Point,
    first_end: Point,
    second_start: Point,
    second_end: Point,
) -> bool:
    first = first_end - first_start
    second = second_end - second_start
    denominator = cross(first, second)
    if abs(denominator) <= EPS:
        return False
    difference = second_start - first_start
    first_ratio = cross(difference, second) / denominator
    second_ratio = cross(difference, first) / denominator
    return (
        -EPS <= first_ratio <= 1.0 + EPS
        and -EPS <= second_ratio <= 1.0 + EPS
    )


def point_in_polygon(point: Point, polygon: list[Point]) -> bool:
    inside = False
    for start, end in polygon_edges(polygon):
        if point_to_segment_distance(point, start, end) <= EPS:
            return True
        if (start.y > point.y) != (end.y > point.y):
            ratio = (end.x - start.x) * (point.y - start.y) / (end.y - start.y)
            if point.x < start.x + ratio:
                inside = not inside
    return inside


def rotation_matrix(theta: float) -> tuple[Point, Point]:
    return (
        Point(math.cos(theta), math.sin(theta)),
        Point(-math.sin(theta), math.cos(theta)),
    )
