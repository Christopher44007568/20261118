"""Blend-tree mixers.

Two implementations share the same weight pipeline so they can be compared:

* :class:`NaiveMixer` blends independently advanced clip clocks and lerps
  every joint.  A sudden speed drop re-enters locomotion with mismatched
  phases and both feet can swing backwards at once.
* :class:`RobustMixer` drives every clip from one shared gait phase, blends
  contact labels first and pins contact ankles to their planted world
  positions.  Footstep events are arbitrated per foot so each physical step
  fires once.
"""
from __future__ import annotations

import math
from .blendspace import BlendSpace
from .clips import build_clips
from .skeleton import Pose

TWO_PI = 2.0 * math.pi


class InputFilter:
    """Asymmetric rate limits: slow decel prevents foot artifacts."""

    def __init__(self, accel=3.5, decel=2.0, turn_rate=4.5):
        self.accel = accel          # m/s^2 speeding up
        self.decel = decel          # m/s^2 slowing down (intentionally low)
        self.turn_rate = turn_rate  # rad/s^2
        self.m = 0.0
        self.t = 0.0

    def step(self, target_m, target_t, dt):
        dm = target_m - self.m
        limit = (self.accel if dm >= 0 else self.decel) * dt
        self.m += max(-limit, min(limit, dm))
        dt_limit = self.turn_rate * dt
        dturn = max(-dt_limit, min(dt_limit, target_t - self.t))
        self.t += dturn
        return self.m, self.t


def blend_scalar(a, b, w):
    return a * (1.0 - w) + b * w


class _BaseMixer:
    def __init__(self):
        self.clips = build_clips()
        self.space = BlendSpace()
        self.phase = 0.0
        self.root = [0.0, 0.95]
        self.events = []
        self.weights = self.space.weights(0.0, 0.0)

    def _cadence(self, weights):
        return sum(self.clips[n].cadence * w for n, w in weights.items())

    def _blend_pose(self, samples, weights, contact_override=None):
        out = Pose()
        active = [n for n, w in weights.items() if w > 1e-6]
        wsum = sum(weights[n] for n in active) or 1.0
        for name in active:
            w = weights[name] / wsum
            p = samples[name]
            out.root = (out.root[0] + p.root[0] * w,
                        out.root[1] + p.root[1] * w)
            out.lean += p.lean * w
        for side in ("L", "R"):
            ax = ay = pitch = 0.0
            contact_vote = 0.0
            for name in active:
                w = weights[name] / wsum
                p = samples[name]
                ax += p.ankles[side][0] * w
                ay += p.ankles[side][1] * w
                pitch += p.foot_pitch[side] * w
                contact_vote += (1.0 if p.contact[side] else 0.0) * w
            out.ankles[side] = (ax, ay)
            out.foot_pitch[side] = pitch
            out.contact[side] = contact_override.get(side, contact_vote >= 0.5) \
                if contact_override is not None else contact_vote >= 0.5
            hx = hy = 0.0
            for name in active:
                w = weights[name] / wsum
                hx += samples[name].hands[side][0] * w
                hy += samples[name].hands[side][1] * w
            out.hands[side] = (hx, hy)
        return out


class NaiveMixer(_BaseMixer):
    """Reference implementation showing the artifact we want to avoid."""

    def __init__(self):
        super().__init__()
        self.phases = {n: 0.0 for n in self.clips}
        self._prev_contact = {"L": True, "R": True}

    def update(self, m, t, dt):
        self.weights = self.space.weights(m, t)
        samples = {}
        for name, clip in self.clips.items():
            self.phases[name] = (
                self.phases[name] + TWO_PI * clip.cadence * dt) % TWO_PI
            samples[name] = clip.sample(self.phases[name], (0.0, 0.95))
        pose = self._blend_pose(samples, self.weights)
        self.root[0] += m * dt
        pose.root = (pose.root[0] + m * dt, pose.root[1])
        # Events come from the dominant clip's own clock: duplicate steps
        # can appear when the dominant clip changes mid-stride.
        dominant = max(self.weights, key=self.weights.get)
        prev = (self.phases[dominant]
                - TWO_PI * self.clips[dominant].cadence * dt) % TWO_PI
        for ev in self.clips[dominant].events(
                prev,
                self.phases[dominant]):
            ev["t"] = getattr(self, "_time", 0.0)
            self.events.append(ev)
        self._time = getattr(self, "_time", 0.0) + dt
        return pose


class RobustMixer(_BaseMixer):
    """Shared-phase, contact-locked mixer with arbitrated events."""

    def __init__(self):
        super().__init__()
        self.planted = {}          # side -> fixed world ankle target
        self._armed = {"L": True, "R": True}
        self._time = 0.0

    def update(self, m, t, dt):
        prev_phase = self.phase
        self.weights = self.space.weights(m, t)
        cadence = self._cadence(self.weights)
        self.phase = (self.phase + TWO_PI * cadence * dt) % TWO_PI

        samples = {
            name: clip.sample(self.phase, tuple(self.root))
            for name, clip in self.clips.items()
        }
        # Vote contact from the blended clips before building the pose.
        contact = {}
        for side in ("L", "R"):
            vote = sum(self.weights[n]
                       for n in samples if samples[n].contact[side])
            contact[side] = vote >= 0.5
        pose = self._blend_pose(samples, self.weights,
                                contact_override=contact)

        # Pin stance ankles: a contact foot never moves while planted,
        # regardless of how the weights change this frame.
        for side in ("L", "R"):
            if contact[side]:
                if side not in self.planted:
                    self.planted[side] = pose.ankles[side]
                pose.ankles[side] = self.planted[side]
            else:
                self.planted.pop(side, None)

        self._emit_events(prev_phase, self.phase)
        self.root[0] += m * dt
        pose.root = (self.root[0], pose.root[1])
        self._time += dt
        return pose

    def _emit_events(self, prev_phase, next_phase):
        # One footstep per foot per crossing of its down-phase.  The arming
        # gate suppresses repeats if dt ever spans more than one cycle.
        for side, ev_phase in (("L", 0.0), ("R", math.pi)):
            crossed = (prev_phase - ev_phase) % TWO_PI > \
                      (next_phase - ev_phase) % TWO_PI
            if crossed and self._armed[side]:
                self.events.append({
                    "clip": "blended", "side": side, "phase": ev_phase,
                    "kind": "footstep", "t": self._time})
                self._armed[side] = False
            if not crossed:
                self._armed[side] = True

