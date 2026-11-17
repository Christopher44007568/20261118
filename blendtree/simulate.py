"""Scenario runner and artifact metrics."""
from __future__ import annotations

from .mixer import NaiveMixer, RobustMixer, InputFilter

DT = 1.0 / 60.0


def run_scenario(name, target_fn, duration, mixer_cls, filtered=True):
    """Roll one mixer over a target trajectory; collect per-frame records."""
    mixer = mixer_cls()
    filt = InputFilter()
    records = []
    prev_ankle = {}
    prev_rel = {}
    max_slide = 0.0
    double_float = 0
    reverse_swing = 0
    planted_slide_frames = 0
    n = int(duration / DT)
    for i in range(n):
        t = i * DT
        raw_m, raw_t = target_fn(t)
        if filtered:
            m, turn = filt.step(raw_m, raw_t, DT)
        else:
            m, turn = max(0.0, raw_m), raw_t
        pose = mixer.update(m, turn, DT)
        events = [e for e in mixer.events
                  if abs(e["t"] - t) <= DT * 0.5]
        # Artifact 1: both feet swinging AND moving backward relative to
        # the root at once.  A normal run flight phase has both feet
        # airborne but both moving forward; only the deceleration artifact
        # produces the simultaneous reverse swing.
        if m > 0.25 and not any(pose.contact.values()):
            double_float += 1
            rel = {
                side: pose.ankles[side][0] - pose.root[0]
                for side in ("L", "R")}
            if all(side in prev_rel and rel[side] < prev_rel[side] - 1e-9
                   for side in ("L", "R")):
                reverse_swing += 1
        # Artifact 2: world-space drift of a foot while it is in contact.
        # A stance foot must stay planted; any motion is visible foot slide.
        for side in ("L", "R"):
            if pose.contact[side]:
                if side in prev_ankle:
                    slide = abs(pose.ankles[side][0] - prev_ankle[side])
                    max_slide = max(max_slide, slide)
                    if slide > 1e-4:
                        planted_slide_frames += 1
                prev_ankle[side] = pose.ankles[side][0]
            else:
                prev_ankle.pop(side, None)
        prev_rel = {
            side: pose.ankles[side][0] - pose.root[0]
            for side in ("L", "R")}
        records.append({
            "t": t, "m": m, "turn": turn,
            "raw_m": raw_m, "raw_t": raw_t,
            "weights": dict(mixer.weights),
            "pose": pose.copy(),
            "events": events,
        })
    metrics = {
        "double_float_frames": double_float,
        "reverse_swing_frames": reverse_swing,
        "planted_slide_frames": planted_slide_frames,
        "event_count": len(mixer.events),
        "max_foot_slide": max_slide,
        "weight_sum_min": min(sum(r["weights"].values()) for r in records),
        "weight_sum_max": max(sum(r["weights"].values()) for r in records),
    }
    return records, metrics


# Three continuous input trajectories (target move m/s, target turn rad/s).
def scenario_sudden_stop(t):
    """Sprint, then an abrupt drop toward idle — the key artifact case."""
    m = 4.0 if t < 2.0 else 0.0
    turn = 0.0
    return m, turn


def scenario_slant_run(t):
    """Forward acceleration with a smooth left-to-right steering sweep."""
    m = min(3.6, 0.9 * t)
    turn = 1.8 * __import__("math").sin(0.8 * t)
    return m, turn


def scenario_stop_and_turn(t):
    """Brake into idle, then a sharp turn-in-place and walk away."""
    if t < 1.5:
        return 2.6, 0.0
    if t < 2.5:
        return 0.0, 0.0
    if t < 4.0:
        return 0.0, 2.0
    return 1.6, -1.2


SCENARIOS = [
    ("sudden_stop", scenario_sudden_stop, 5.0),
    ("slant_run", scenario_slant_run, 5.0),
    ("stop_and_turn", scenario_stop_and_turn, 5.5),
]
