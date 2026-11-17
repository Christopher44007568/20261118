"""Edge-protection ablation: weak vs strong range weighting in adaptive filter."""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import materials
import metrics
import reconstruct

OUT = os.path.join(os.path.dirname(__file__), "..", "outputs")
RADIUS = 4


def main():
    out = {}
    for mat_name, ctor in materials.MATERIALS.items():
        d = ctor()
        gy, gx = reconstruct.central_gradient(d["height"])
        n_gt = reconstruct.make_normal(gy, gx)
        out[mat_name] = {}
        for label, es in [("weak(0.5x)", 0.5), ("normal(1x)", 1.0),
                          ("strong(2x)", 2.0)]:
            hf = reconstruct.adaptive_filter(d["measured"], d["roughness"],
                                             RADIUS, edge_strength=es)
            gy, gx = reconstruct.central_gradient(hf)
            n_est = reconstruct.make_normal(gy, gx)
            out[mat_name][label] = metrics.evaluate(
                n_est, n_gt, d["height"], d["roughness"])
    with open(os.path.join(OUT, "edge_ablation.json"), "w") as f:
        json.dump(out, f, indent=2)
    for mat, rows in out.items():
        print(f"\n=== {mat} (radius={RADIUS}) ===")
        for label, s in rows.items():
            print(f"{label:12s} MAE={s['mae_deg']:5.2f} flat={s['mae_flat_deg']:5.2f} "
                  f"edge={s['mae_edge_deg']:5.2f} art={s['edge_artifact']:.3f} roughN={s['rough_noise']:.4f}")


if __name__ == "__main__":
    main()
