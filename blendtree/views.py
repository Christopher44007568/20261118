"""SVG views: blend space, weight timeline, skeleton strip, summary panel."""
from __future__ import annotations

from .svgview import Svg, Transform, PALETTE
from .clips import CLIP_NAMES


def render_blend_space(space, trail, path, width=620, height=480):
    svg = Svg(width, height, "Blend space (move speed x turn speed)")
    tf = Transform(70, height / 2, 110, 90)
    # axes
    svg.line(tf((0, -2.6)), tf((0, 2.6)), "#999", 1)
    svg.line(tf((-0.2, 0)), tf((4.7, 0)), "#999", 1)
    for m in range(5):
        p = tf((m, 0))
        svg.line((p[0], p[1] - 4), (p[0], p[1] + 4), "#999", 1)
        svg.text((p[0], p[1] + 18), str(m), 10, "#666", "middle")
    for t in (-2, -1, 1, 2):
        p = tf((0, t))
        svg.line((p[0] - 4, p[1]), (p[0] + 4, p[1]), "#999", 1)
        svg.text((p[0] - 8, p[1] + 3), str(t), 10, "#666", "end")
    svg.text(tf((4.65, -0.18)), "move m/s", 11, "#444")
    svg.text(tf((0.05, 2.5)), "turn rad/s", 11, "#444")
    # triangulation edges
    edge_set = set()
    for tri in space.tris:
        idx = tri.idx
        for a, b in zip(idx, idx[1:] + idx[:1]):
            edge = tuple(sorted((a, b)))
            if edge not in edge_set:
                edge_set.add(edge)
                pa, pb = space.points[edge[0]], space.points[edge[1]]
                svg.line(tf((pa.m, pa.t)), tf((pb.m, pb.t)),
                         "#cccccc", 1, dash="4 3")
    # clip points
    for p in space.points:
        svg.circle(tf((p.m, p.t)), 6, PALETTE[p.name], 1.0, "#333")
        svg.text((tf((p.m, p.t))[0] + 9, tf((p.m, p.t))[1] + 4),
                 p.name, 11, "#222", weight=600)
    # input trail
    screen = [tf((m, t)) for m, t in trail]
    if len(screen) > 1:
        svg.polyline(screen, "#d62828", 2.0)
        for p in screen[::max(1, len(screen) // 12)]:
            svg.circle(p, 2.5, "#d62828")
    svg.circle(screen[-1], 5, "#d62828", 1.0, "#fff")
    svg.save(path)
    return svg


def render_weight_timeline(records, path, width=900, height=300,
                           title="Clip weights over time"):
    svg = Svg(width, height, title)
    left, top, plot_w, plot_h = 60, 40, width - 160, height - 80
    n = len(records)
    if n < 2:
        svg.save(path)
        return svg

    def x(i):
        return left + plot_w * i / (n - 1)

    def y(v):
        return top + plot_h * (1.0 - v)

    for v in (0, 0.25, 0.5, 0.75, 1.0):
        svg.line((left, y(v)), (left + plot_w, y(v)), "#e5e5e5", 1)
        svg.text((left - 8, y(v) + 4), f"{v:.2f}", 10, "#666", "end")
    # stacked areas guarantee the visible total is 1.0
    running = [0.0] * n
    for name in CLIP_NAMES:
        vals = [r["weights"][name] for r in records]
        top_line = [running[i] + vals[i] for i in range(n)]
        poly = [(x(i), y(running[i])) for i in range(n)]
        poly += [(x(i), y(top_line[i])) for i in range(n - 1, -1, -1)]
        svg.polygon(poly, PALETTE[name], 0.85)
        running = top_line
    svg.line((left, y(1.0)), (left + plot_w, y(1.0)), "#333", 1.2)
    # event markers
    ev_times = sorted({r["t"] for r in records for e in r["events"]})
    duration = records[-1]["t"] or 1.0
    for et in ev_times:
        ex = left + plot_w * et / duration
        svg.line((ex, top), (ex, top + plot_h), "#222", 1.0, dash="2 3",
                 opacity=0.7)
    # legend
    for i, name in enumerate(CLIP_NAMES):
        ly = top + 16 * i
        svg.rect(left + plot_w + 18, ly - 9, 12, 12, PALETTE[name])
        svg.text((left + plot_w + 35, ly + 1), name, 11)
    svg.text((left, height - 18),
             f"0.0 s                          "
             f"{duration:.1f} s   (dashed lines = footstep events)",
             10, "#666")
    svg.save(path)
    return svg


def render_skeleton_strip(records, skeleton, path, width=1000, height=360,
                          title="Skeleton state (contact feet locked)"):
    svg = Svg(width, height, title)
    frames = records
    step = max(1, len(frames) // 8)
    picked = frames[::step][:8]
    cell_w = (width - 40) / len(picked)
    scale = 130.0
    ground_y = height - 60
    for i, rec in enumerate(picked):
        ox = 20 + cell_w * (i + 0.5)
        tf = Transform(ox, ground_y, scale)
        svg.line((ox - cell_w / 2 + 8, ground_y),
                 (ox + cell_w / 2 - 8, ground_y), "#bbb", 1.5)
        joints = skeleton.solve(rec["pose"])
        for p1, p2, layer in skeleton.bone_segments(joints):
            color = "#8d99ae" if layer == 1 else "#2b2d42"
            w = 1.4 if layer == 1 else 2.4
            svg.line(tf(p1), tf(p2), color, w)
        for side in ("L", "R"):
            ankle = joints[f"ankle_{side}"]
            if rec["pose"].contact[side]:
                svg.circle(tf(ankle), 4.5, "#2a9d8f", 1.0, "#1d6f66")
            else:
                svg.circle(tf(ankle), 3.5, "#e76f51", 1.0)
        head = joints["head"]
        svg.circle(tf(head), 7, "#2b2d42")
        svg.text((ox, height - 38),
                 f"t={rec['t']:.2f}s m={rec['m']:.1f} t={rec['turn']:.1f}",
                 10, "#555", "middle")
        w = rec["weights"]
        label = ", ".join(f"{k}:{v:.2f}" for k, v in w.items() if v > 0.02)
        svg.text((ox, height - 22), label, 9, "#777", "middle")
    svg.text((20, height - 6),
             "green = contact (locked)   orange = swing", 10, "#555")
    svg.save(path)
    return svg


def render_summary_panel(scenarios, path, width=980, height=420):
    svg = Svg(width, height, "Scenario summary: naive vs robust mixer")
    rows = ["scenario", "reverse-swing\nframes (naive)",
            "reverse-swing\nframes (robust)", "events\n(naive)",
            "events\n(robust)", "max foot\nslide m (robust)"]
    col_x = [20, 300, 480, 640, 760, 880]
    y0 = 60
    for cx, label in zip(col_x, rows):
        for j, part in enumerate(label.split("\n")):
            svg.text((cx, y0 - 16 + j * 12), part, 11, "#333", weight=600)
    for i, sc in enumerate(scenarios):
        ry = y0 + 34 * i
        if i % 2 == 0:
            svg.rect(12, ry - 14, width - 24, 30, "#f2f5f7")
        svg.text((col_x[0], ry + 4), sc["name"], 11)
        vals = [
            str(sc["naive"]["reverse_swing_frames"]),
            str(sc["robust"]["reverse_swing_frames"]),
            str(sc["naive"]["event_count"]),
            str(sc["robust"]["event_count"]),
            f"{sc['robust']['max_foot_slide']:.3f}",
        ]
        for cx, val in zip(col_x[1:], vals):
            svg.text((cx, ry + 4), val, 11)
    svg.text((20, height - 24),
             "Weights are barycentric and always sum to 1.0; robust mixer "
             "uses shared gait phase + stance lock + per-foot event gating.",
             10, "#666")
    svg.save(path)
    return svg
