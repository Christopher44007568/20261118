"""Run the full normal-reconstruction comparison and write artifacts."""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import materials
import metrics
import reconstruct
import viz

OUT = os.path.join(os.path.dirname(__file__), "..", "outputs")
RADII = [0, 1, 2, 4, 8]
METHODS = ["central", "sobel", "adaptive"]
METHOD_LABEL = {"central": "central", "sobel": "sobel", "adaptive": "adaptive"}


def gt_normal(clean_h):
    gy, gx = reconstruct.central_gradient(clean_h)
    return reconstruct.make_normal(gy, gx)


def main():
    os.makedirs(os.path.join(OUT, "figures"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "debug"), exist_ok=True)
    report = {}
    for mat_name, ctor in materials.MATERIALS.items():
        d = ctor()
        n_gt = gt_normal(d["height"])
        viz.save_png(os.path.join(OUT, f"{mat_name}_height.png"),
                     viz.to_u8(np.stack([d["measured"]] * 3, -1)))
        viz.save_png(os.path.join(OUT, f"{mat_name}_roughness.png"),
                     viz.to_u8(np.stack([d["roughness"]] * 3, -1)))
        viz.save_png(os.path.join(OUT, f"{mat_name}_normal_gt.png"),
                     viz.normal_colormap(n_gt))
        report[mat_name] = {}
        for method in METHODS:
            rows = []
            for radius in RADII:
                n_est, hf = reconstruct.reconstruct(
                    d["measured"], d["roughness"], method, max(radius, 0.5))
                stats = metrics.evaluate(n_est, n_gt, d["height"], d["roughness"])
                stats["radius"] = radius
                rows.append(stats)
                tag = f"{mat_name}_{method}_r{radius}"
                viz.save_png(os.path.join(OUT, "figures", f"{tag}_normal.png"),
                             viz.normal_colormap(n_est))
                viz.save_png(os.path.join(OUT, "figures", f"{tag}_lit.png"),
                             viz.lit_preview(n_est))
                if radius in (2, 8) and method in ("central", "adaptive"):
                    dbg, vmax = viz.height_diff_debug(d["measured"], hf)
                    viz.save_png(os.path.join(OUT, "debug", f"{tag}_hdiff.png"), dbg)
            report[mat_name][method] = rows
    with open(os.path.join(OUT, "metrics.json"), "w") as f:
        json.dump(report, f, indent=2)
    print("wrote", os.path.join(OUT, "metrics.json"))


if __name__ == "__main__":
    main()
