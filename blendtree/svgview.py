"""Tiny hand-rolled SVG writer (stdlib only).

Screen coordinates use y-down; world coordinates use y-up, so every view
maps through a transform supplied by the caller.
"""
from __future__ import annotations

import html


PALETTE = {
    "idle": "#606c76",
    "walk": "#2a9d8f",
    "run": "#e76f51",
    "turnL": "#457b9d",
    "turnR": "#9b5de5",
}


class Svg:
    def __init__(self, width, height, title=""):
        self.w = width
        self.h = height
        self.items = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
            f'height="{height}" viewBox="0 0 {width} {height}" '
            f'font-family="Helvetica,Arial,sans-serif">',
            f'<rect width="{width}" height="{height}" fill="#ffffff"/>',
        ]
        if title:
            self.items.append(
                f'<text x="12" y="22" font-size="15" font-weight="700" '
                f'fill="#222">{html.escape(title)}</text>')

    def line(self, p1, p2, color="#333", width=1.5, dash=None, opacity=1.0):
        extra = f' stroke-dasharray="{dash}"' if dash else ""
        self.items.append(
            f'<line x1="{p1[0]:.2f}" y1="{p1[1]:.2f}" '
            f'x2="{p2[0]:.2f}" y2="{p2[1]:.2f}" stroke="{color}" '
            f'stroke-width="{width}" opacity="{opacity}"{extra} '
            f'stroke-linecap="round"/>')

    def polyline(self, pts, color="#333", width=1.5, dash=None, fill="none"):
        pts_s = " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
        extra = f' stroke-dasharray="{dash}"' if dash else ""
        self.items.append(
            f'<polyline points="{pts_s}" fill="{fill}" stroke="{color}" '
            f'stroke-width="{width}"{extra} stroke-linejoin="round"/>')

    def polygon(self, pts, fill, opacity=1.0, stroke="none"):
        pts_s = " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
        self.items.append(
            f'<polygon points="{pts_s}" fill="{fill}" fill-opacity="{opacity}"'
            f' stroke="{stroke}"/>')

    def circle(self, p, r, fill="#333", opacity=1.0, stroke="none"):
        self.items.append(
            f'<circle cx="{p[0]:.2f}" cy="{p[1]:.2f}" r="{r:.2f}" '
            f'fill="{fill}" opacity="{opacity}" stroke="{stroke}"/>')

    def text(self, p, s, size=11, color="#222", anchor="start", weight=400):
        self.items.append(
            f'<text x="{p[0]:.2f}" y="{p[1]:.2f}" font-size="{size}" '
            f'fill="{color}" text-anchor="{anchor}" '
            f'font-weight="{weight}">{html.escape(str(s))}</text>')

    def rect(self, x, y, w, h, fill, opacity=1.0):
        self.items.append(
            f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" '
            f'height="{h:.2f}" fill="{fill}" opacity="{opacity}"/>')

    def save(self, path):
        self.items.append("</svg>")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(self.items))


class Transform:
    """Map world (x right, y up) into screen pixels (y down)."""

    def __init__(self, ox, oy, sx, sy=None):
        self.ox, self.oy, self.sx = ox, oy, sx
        self.sy = sy if sy is not None else sx

    def __call__(self, p):
        return (self.ox + p[0] * self.sx, self.oy - p[1] * self.sy)
