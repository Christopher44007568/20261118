"""2D blend space: move speed (m/s) x turn speed (rad/s).

The five clips sit at fixed points.  The convex hull is triangulated once;
an inside input gets the barycentric coordinates of its containing triangle
(weights therefore sum to exactly 1.0).  Outside input is snapped to the
nearest hull edge and blended along that edge.
"""
from __future__ import annotations

import math


class BlendPoint:
    __slots__ = ("name", "m", "t")

    def __init__(self, name, m, t):
        self.name = name
        self.m = m
        self.t = t


class Triangle:
    __slots__ = ("idx",)

    def __init__(self, idx):
        self.idx = tuple(idx)

    def barycentric(self, pts, m, t):
        (i, j, k), p = self.idx, pts
        den = ((p[j].t - p[k].t) * (p[i].m - p[k].m)
               + (p[k].m - p[j].m) * (p[i].t - p[k].t))
        if abs(den) < 1e-12:
            return None
        sign = 1.0 if den > 0 else -1.0
        wi = ((p[j].t - p[k].t) * (m - p[k].m)
              + (p[k].m - p[j].m) * (t - p[k].t)) / den
        wj = ((p[k].t - p[i].t) * (m - p[k].m)
              + (p[i].m - p[k].m) * (t - p[k].t)) / den
        wk = 1.0 - wi - wj
        if sign * wi < -1e-9 or sign * wj < -1e-9 or sign * wk < -1e-9:
            return None
        wi, wj, wk = sign * wi, sign * wj, sign * wk
        return {i: wi, j: wj, k: wk}


class BlendSpace:
    # Fan triangulation around the idle vertex; the walk->run spine is an
    # internal edge shared by the two turn triangles, so the whole convex
    # hull is covered without gaps or overlaps.
    # Winding is normalized at runtime via the sign guard in Triangle.
    TRIS = ((0, 4, 1), (0, 1, 3), (1, 4, 2), (1, 2, 3))

    def __init__(self):
        self.points = [
            BlendPoint("idle", 0.0, 0.0),
            BlendPoint("walk", 1.4, 0.0),
            BlendPoint("run", 4.2, 0.0),
            BlendPoint("turnL", 0.9, 2.2),
            BlendPoint("turnR", 0.9, -2.2),
        ]
        self.names = [p.name for p in self.points]
        self.tris = [Triangle(t) for t in self.TRIS]
        self.hull = self._convex_hull()

    def _convex_hull(self):
        pts = sorted(self.points, key=lambda p: (p.m, p.t))

        def cross(o, a, b):
            return ((a.m - o.m) * (b.t - o.t)
                    - (a.t - o.t) * (b.m - o.m))

        lower = []
        for p in pts:
            while len(lower) > 1 and cross(lower[-2], lower[-1], p) <= 0:
                lower.pop()
            lower.append(p)
        upper = []
        for p in reversed(pts):
            while len(upper) > 1 and cross(upper[-2], upper[-1], p) <= 0:
                upper.pop()
            upper.append(p)
        return lower[:-1] + upper[:-1]

    def _edge_snap(self, m, t):
        """Nearest point on a hull edge -> two-vertex blend weights."""
        best = None
        hull = self.hull
        for a, b in zip(hull, hull[1:] + hull[:1]):
            dx, dy = b.m - a.m, b.t - a.t
            length2 = dx * dx + dy * dy
            u = ((m - a.m) * dx + (t - a.t) * dy) / length2
            u = max(0.0, min(1.0, u))
            qm, qt = a.m + u * dx, a.t + u * dy
            dist2 = (m - qm) ** 2 + (t - qt) ** 2
            if best is None or dist2 < best[0]:
                ia = self.names.index(a.name)
                ib = self.names.index(b.name)
                best = (dist2, {ia: 1.0 - u, ib: u})
        return best[1]

    def weights(self, m, t):
        """Return clip-name -> weight; weights always sum to 1.0."""
        raw = None
        for tri in self.tris:
            raw = tri.barycentric(self.points, m, t)
            if raw is not None:
                break
        if raw is None:
            raw = self._edge_snap(m, t)
        w = {name: 0.0 for name in self.names}
        total = 0.0
        for idx, value in raw.items():
            v = max(0.0, value)
            w[self.names[idx]] = v
            total += v
        if total <= 0.0:
            w["idle"] = 1.0
            return w
        return {name: value / total for name, value in w.items()}

    def weight_grid(self, m_max=4.6, t_max=2.6, step=0.2):
        rows = []
        n = int(t_max / step)
        for ti in range(-n, n + 1):
            row = []
            for mi in range(0, int(m_max / step) + 1):
                row.append(self.weights(mi * step, ti * step))
            rows.append(row)
        return rows, step
