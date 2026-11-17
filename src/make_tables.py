"""Write CSV + Markdown summary tables of all metrics."""
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from experiment import RADII, METHODS

OUT = os.path.join(os.path.dirname(__file__), "..", "outputs")
KEYS = ["mae_deg", "median_deg", "p95_deg", "rmse", "mae_flat_deg",
        "mae_edge_deg", "edge_artifact", "rough_noise"]


def main():
    report = json.load(open(os.path.join(OUT, "metrics.json")))
    with open(os.path.join(OUT, "summary.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["material", "method", "radius"] + KEYS)
        for mat, methods in report.items():
            for m in METHODS:
                for s in methods[m]:
                    w.writerow([mat, m, s["radius"]] + [round(s[k], 5) for k in KEYS])

    lines = ["# Normal reconstruction results\n",
             "Angular error in degrees. edge_artifact / rough_noise are "
             "dimensionless (lower is better for all columns).\n"]
    for mat, methods in report.items():
        lines.append(f"\n## {mat}\n")
        lines.append("| method | r | MAE° | median° | p95° | flat° | edge° | edge artifact | rough noise |")
        lines.append("|---|--:|--:|--:|--:|--:|--:|--:|--:|")
        for m in METHODS:
            for s in methods[m]:
                lines.append(
                    f"| {m} | {s['radius']} | {s['mae_deg']:.2f} | "
                    f"{s['median_deg']:.2f} | {s['p95_deg']:.2f} | "
                    f"{s['mae_flat_deg']:.2f} | {s['mae_edge_deg']:.2f} | "
                    f"{s['edge_artifact']:.3f} | {s['rough_noise']:.4f} |")
    abl = json.load(open(os.path.join(OUT, "edge_ablation.json")))
    lines.append("\n## Edge-protection ablation (adaptive, r=4)\n")
    lines.append("| material | setting | MAE° | flat° | edge° | edge artifact | rough noise |")
    lines.append("|---|---|--:|--:|--:|--:|--:|")
    for mat, rows in abl.items():
        for label, s in rows.items():
            lines.append(
                f"| {mat} | {label} | {s['mae_deg']:.2f} | "
                f"{s['mae_flat_deg']:.2f} | {s['mae_edge_deg']:.2f} | "
                f"{s['edge_artifact']:.3f} | {s['rough_noise']:.4f} |")
    with open(os.path.join(OUT, "RESULTS.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("tables written")


if __name__ == "__main__":
    main()
