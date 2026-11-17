"""Procedural locomotion clips authored from a shared gait phase.

Every moving clip samples the *same* phase convention (0.0 = left foot
down / start of left stance).  Phase-aligned authoring is the first line of
defence against cross-leg artifacts when weights change: blending two clips
never blends two mismatched moments of the gait cycle.

Each clip exposes:
  * ``sample(phase, root)`` -> :class:`Pose` with world-space ankle targets
    and per-foot contact flags;
  * ``events(phase_prev, phase_next)`` -> event dicts whose frame fell in
    the phase interval (used to count footstep events after blending).
"""
from __future__ import annotations

import math
from .skeleton import Pose

CLIP_NAMES = ("idle", "walk", "run", "turnL", "turnR")
TWO_PI = 2.0 * math.pi


def _norm(phase):
    return phase % TWO_PI


class Clip:
    def __init__(self, name, cadence, stance_ratio, step_len, lift,
                 lean, bounce, turn_sign=0.0):
        self.name = name
        self.cadence = cadence          # full cycles per second
        self.stance_ratio = stance_ratio
        self.step_len = step_len        # per-foot forward stride (m)
        self.lift = lift                # swing toe height (m)
        self.lean = lean                # radians
        self.bounce = bounce            # vertical root amplitude (m)
        self.turn_sign = turn_sign      # +1 left, -1 right, 0 straight
        # Foot-down event phases: left at 0, right half a cycle later.
        self.event_phases = (0.0, math.pi)

    def _foot_phase(self, phase, side):
        return _norm(phase - (0.0 if side == "L" else math.pi))

    def _ankle(self, phase, root, side, scale=1.0):
        fp = self._foot_phase(phase, side)
        stance_end = self.stance_ratio * TWO_PI
        rx, ry = root
        if fp <= stance_end:
            # Stance: foot is planted, sweeps from ahead to behind the hip.
            u = fp / stance_end
            x = rx + (0.5 - u) * self.step_len * scale
            y = 0.08
            contact = True
            pitch = -0.25 * u
        else:
            # Swing: lift the toe and return it ahead of the hip.
            u = (fp - stance_end) / (TWO_PI - stance_end)
            x = rx + (-0.5 + u) * self.step_len * scale
            y = 0.08 + self.lift * math.sin(math.pi * u)
            contact = False
            pitch = 0.35 * math.sin(math.pi * u)
        return (x, y), contact, pitch

    def sample(self, phase, root=(0.0, 0.95)):
        pose = Pose(root=root, lean=self.lean)
        scale = 1.0
        bob = self.bounce * math.cos(phase)
        pose.root = (root[0], root[1] + bob)
        for side in ("L", "R"):
            ankle, contact, pitch = self._ankle(phase, pose.root, side, scale)
            pose.ankles[side] = ankle
            pose.contact[side] = contact
            pose.foot_pitch[side] = pitch
            # Arms counter-swing against the same-side leg.
            fp = self._foot_phase(phase, side)
            swing = math.sin(fp) * (0.30 if self.name != "run" else 0.42)
            pose.hands[side] = (swing, pose.root[1] - 0.42)
        # A turn clip rotates the chest and lifts the inside foot a touch.
        if self.turn_sign:
            pose.lean += 0.12 * self.turn_sign
            inside = "L" if self.turn_sign > 0 else "R"
            ax, ay = pose.ankles[inside]
            pose.ankles[inside] = (ax, ay + 0.03)
        return pose

    def events(self, phase_prev, phase_next):
        """Footstep event frames crossed while phase advanced."""
        out = []
        travelled = (phase_next - phase_prev) % TWO_PI
        for side, ev in zip(("L", "R"), self.event_phases):
            # Distance forward along the phase circle from prev to event.
            delta = (ev - phase_prev) % TWO_PI
            if delta <= travelled + 1e-9 and travelled < TWO_PI - 1e-9:
                out.append({"clip": self.name, "side": side,
                            "phase": ev, "kind": "footstep"})
        return out


def build_clips():
    """Return the five authored clips keyed by name."""
    return {
        "idle": Clip("idle", cadence=0.0, stance_ratio=1.0, step_len=0.0,
                     lift=0.0, lean=0.0, bounce=0.006),
        "walk": Clip("walk", cadence=0.9, stance_ratio=0.62, step_len=0.55,
                     lift=0.10, lean=0.05, bounce=0.015),
        "run": Clip("run", cadence=1.6, stance_ratio=0.38, step_len=1.05,
                    lift=0.28, lean=0.16, bounce=0.05),
        "turnL": Clip("turnL", cadence=0.8, stance_ratio=0.55,
                      step_len=0.35, lift=0.12, lean=0.08,
                      bounce=0.012, turn_sign=+1),
        "turnR": Clip("turnR", cadence=0.8, stance_ratio=0.55,
                      step_len=0.35, lift=0.12, lean=0.08,
                      bounce=0.012, turn_sign=-1),
    }
