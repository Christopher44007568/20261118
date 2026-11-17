"""Entry point: run three trajectories, compare mixers, emit SVG views."""
from __future__ import annotations

import csv
import os

from blendtree.mixer import NaiveMixer, RobustMixer
from blendtree.simulate import run_scenario, SCENARIOS
from blendtree.skeleton import Skeleton
from blendtree import views

OUT = os.path.join(os.path.dirname(__file__), "artifacts", "anim")


def main():
    os.makedirs(OUT, exist_ok=True)
    skeleton = Skeleton()
    summary = []
    for name, fn, duration in SCENARIOS:
        robust_rec, robust_metrics = run_scenario(
            name, fn, duration, RobustMixer)
        naive_rec, naive_metrics = run_scenario(
            name, fn, duration, NaiveMixer)

        views.render_weight_timeline(
            robust_rec, os.path.join(OUT, f"{name}_weights.svg"),
            title=f"{name}: weights + footstep events")
        views.render_skeleton_strip(
            robust_rec, skeleton,
            os.path.join(OUT, f"{name}_skeleton.svg"),
            title=f"{name}: blended skeleton states")
        trail = [(r["m"], r["turn"]) for r in robust_rec]
        views.render_blend_space(
            RobustMixer().space, trail,
            os.path.join(OUT, f"{name}_blendspace.svg"))
        _write_csv(robust_rec, os.path.join(OUT, f"{name}_weights.csv"))
        _write_events(robust_rec, os.path.join(OUT, f"{name}_events.csv"))
        summary.append({
            "name": name,
            "naive": naive_metrics,
            "robust": robust_metrics,
        })
        print(f"== {name} ==")
        print(f"  weight sum range: "
              f"{robust_metrics['weight_sum_min']:.6f} .. "
              f"{robust_metrics['weight_sum_max']:.6f}")
        print(f"  naive  : {naive_metrics}")
        print(f"  robust : {robust_metrics}")
    views.render_summary_panel(
        summary, os.path.join(OUT, "summary.svg"))
    _write_summary_csv(summary, os.path.join(OUT, "summary.csv"))
    print(f"\nViews and CSVs written to {OUT}")


def _write_csv(records, path):
    names = list(records[0]["weights"])
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["t", "raw_m", "raw_t", "m", "turn", *names,
                         "weight_sum", "contact_L", "contact_R"])
        for r in records:
            writer.writerow([
                f"{r['t']:.4f}", f"{r['raw_m']:.3f}", f"{r['raw_t']:.3f}",
                f"{r['m']:.3f}", f"{r['turn']:.3f}",
                *[f"{r['weights'][n]:.4f}" for n in names],
                f"{sum(r['weights'].values()):.6f}",
                int(r["pose"].contact["L"]), int(r["pose"].contact["R"]),
            ])


def _write_events(records, path):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["t", "side", "kind", "m", "turn"])
        for r in records:
            for ev in r["events"]:
                writer.writerow([f"{ev['t']:.4f}", ev["side"], ev["kind"],
                                 f"{r['m']:.3f}", f"{r['turn']:.3f}"])


def _write_summary_csv(summary, path):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["scenario", "mixer", "double_float_frames",
                         "event_count", "max_foot_slide",
                         "weight_sum_min", "weight_sum_max"])
        for sc in summary:
            for mixer_name in ("naive", "robust"):
                m = sc[mixer_name]
                writer.writerow([
                    sc["name"], mixer_name, m["double_float_frames"],
                    m["event_count"], f"{m['max_foot_slide']:.4f}",
                    f"{m['weight_sum_min']:.6f}",
                    f"{m['weight_sum_max']:.6f}"])


if __name__ == "__main__":
    main()
