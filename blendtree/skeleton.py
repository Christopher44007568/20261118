"""Minimal sagittal (side-view) skeleton with analytic two-bone IK.

Coordinates: +x is forward (screen right), +y is up.  Two legs and two arms
are kept (near/far in the side view) so foot contact and counter-swing are
visible.  A :class:`Pose` drives limbs by ankle/hand *targets*, which lets
the mixer lock a stance foot to a fixed world position during contact.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field


def _angle(a, b):
    return math.atan2(b[1] - a[1], b[0] - a[0])


def two_bone_ik(a, b, l1, l2, pole):
    """Return joint positions (a, mid, b) for a hinge with fixed bone lengths.

    ``pole`` selects the bend side (+1 / -1).  Targets beyond reach are
    clamped to full extension instead of producing NaNs.
    """
    dx, dy = b[0] - a[0], b[1] - a[1]
    d = math.hypot(dx, dy)
    reach = l1 + l2 - 1e-6
    if d < 1e-6:
        d = 1e-6
    d = min(d, reach)
    cos_a = (l1 * l1 + d * d - l2 * l2) / (2.0 * l1 * d)
    cos_a = max(-1.0, min(1.0, cos_a))
    bend = pole * math.acos(cos_a)
    base = math.atan2(dy, dx)
    mid = (a[0] + l1 * math.cos(base + bend),
           a[1] + l1 * math.sin(base + bend))
    end = (a[0] + d * math.cos(base), a[1] + d * math.sin(base))
    return (a, mid, end)


@dataclass
class Pose:
    """Targets and state for one skeleton at one instant."""
    root: tuple = (0.0, 0.95)
    lean: float = 0.0
    # side -> world ankle target, foot pitch (rad), contact flag
    ankles: dict = field(default_factory=dict)
    foot_pitch: dict = field(default_factory=dict)
    contact: dict = field(default_factory=dict)
    # side -> hand target relative to the root
    hands: dict = field(default_factory=dict)

    def copy(self):
        return Pose(
            root=self.root, lean=self.lean,
            ankles=dict(self.ankles), foot_pitch=dict(self.foot_pitch),
            contact=dict(self.contact), hands=dict(self.hands),
        )


class Skeleton:
    SIDES = ("L", "R")

    def __init__(self):
        self.thigh = 0.46
        self.shin = 0.45
        self.upper_arm = 0.30
        self.forearm = 0.28
        self.spine = 0.52
        self.neck = 0.22
        self.hip_half = 0.09
        self.shoulder_half = 0.10
        self.foot_len = 0.20

    def solve(self, pose: Pose):
        """Run IK for every limb and return a dict of named joint positions."""
        rx, ry = pose.root
        c, s = math.cos(pose.lean), math.sin(pose.lean)
        chest = (rx - s * self.spine, ry + c * self.spine)
        head = (chest[0] - math.sin(pose.lean + 0.15) * self.neck,
                chest[1] + math.cos(pose.lean + 0.15) * self.neck)
        out = {"root": pose.root, "chest": chest, "head": head}
        for side in self.SIDES:
            sign = 1.0 if side == "L" else -1.0
            hip = (rx + sign * self.hip_half, ry)
            shoulder = (chest[0] + sign * self.shoulder_half, chest[1])
            out[f"hip_{side}"] = hip
            out[f"shoulder_{side}"] = shoulder
            ankle_t = pose.ankles.get(side, (hip[0], 0.0))
            hip_j, knee, ankle = two_bone_ik(
                hip, ankle_t, self.thigh, self.shin, pole=1.0)
            out[f"knee_{side}"] = knee
            out[f"ankle_{side}"] = ankle
            pitch = pose.foot_pitch.get(side, 0.0)
            out[f"toe_{side}"] = (
                ankle[0] + self.foot_len * math.cos(pitch),
                ankle[1] + self.foot_len * math.sin(pitch))
            hand_t = pose.hands.get(side, (shoulder[0], shoulder[1] - 0.4))
            hand_world = (rx + hand_t[0], hand_t[1])
            sh, elbow, hand = two_bone_ik(
                shoulder, hand_world, self.upper_arm, self.forearm,
                pole=-1.0)
            out[f"elbow_{side}"] = elbow
            out[f"hand_{side}"] = hand
        return out

    def bone_segments(self, joints):
        """Flat list of (p1, p2, layer) polylines for rendering."""
        segs = []
        for side in self.SIDES:
            layer = 2 if side == "L" else 1
            chain = (f"hip_{side}", f"knee_{side}", f"ankle_{side}",
                     f"toe_{side}")
            for a, b in zip(chain, chain[1:]):
                segs.append((joints[a], joints[b], layer))
            chain = (f"shoulder_{side}", f"elbow_{side}", f"hand_{side}")
            for a, b in zip(chain, chain[1:]):
                segs.append((joints[a], joints[b], layer))
        segs.append((joints["root"], joints["chest"], 3))
        segs.append((joints["chest"], joints["head"], 3))
        segs.append((joints["hip_L"], joints["hip_R"], 0))
        segs.append((joints["shoulder_L"], joints["shoulder_R"], 0))
        return segs
