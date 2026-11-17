"""Generate summary plots from outputs/metrics.json."""
import json
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(__file__))
from experiment import RADII, METHODS

OUT = os.path.join(os.path.dirname(__file__), "..", "outputs")
MARKER = {"central": "o", "sobel": "s", "adaptive": "^"}


def load():
    with open(os.path.join(OUT, "metrics.json")) as f:
        return json.load(f)


def plot_metric(report, metric, ylabel, fname, logy=False):
    mats = list(report)
    fig, axes = plt.subplots(1, len(mats), figsize=(5 * len(mats), 4), sharex=True)
    for ax, mat in zip(axes, mats):
        for m in METHODS:
            ys = [s[metric] for s in report[mat][m]]
            ax.plot(RADII, ys, marker=MARKER[m], label=m)
        ax.set_title(mat.replace("_", " "))
        ax.set_xlabel("filter radius (px)")
        ax.grid(alpha=0.3)
        if logy:
            ax.set_yscale("log")
        ax.legend(fontsize=8)
    axes[0].set_ylabel(ylabel)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, fname), dpi=110)
    plt.close(fig)


def main():
    report = load()
    plot_metric(report, "mae_deg", "angular MAE (deg)", "fig_mae_vs_radius.png")
    plot_metric(report, "rough_noise", "rough-region normal noise",
                "fig_rough_noise.png", logy=True)
    plot_metric(report, "edge_artifact", "edge artifact score",
                "fig_edge_artifact.png")
    plot_metric(report, "mae_edge_deg", "edge angular error (deg)",
                "fig_edge_error.png")
    print("figures written")


if __name__ == "__main__":
    main()
