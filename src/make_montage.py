"""Montage: GT, then per-method normal map / lit preview / height-diff debug."""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from materials import MATERIALS

OUT = os.path.join(os.path.dirname(__file__), "..", "outputs")
R = 4
METHODS = ["central", "sobel", "adaptive"]


def img(path):
    return Image.open(path)


def main():
    for mat in MATERIALS:
        rows = [
            ("normal", lambda m: img(f"{OUT}/figures/{mat}_{m}_r{R}_normal.png")),
            ("lit", lambda m: img(f"{OUT}/figures/{mat}_{m}_r{R}_lit.png")),
        ]
        fig, axes = plt.subplots(2, 4, figsize=(13, 6.6))
        gt_n = img(f"{OUT}/{mat}_normal_gt.png")
        gt_lit = img(f"{OUT}/figures/{mat}_central_r1_lit.png")
        axes[0, 0].imshow(gt_n)
        axes[0, 0].set_title("GT normal")
        axes[1, 0].imshow(img(f"{OUT}/{mat}_height.png"))
        axes[1, 0].set_title("measured height")
        for j, m in enumerate(METHODS, start=1):
            axes[0, j].imshow(rows[0][1](m))
            axes[0, j].set_title(f"{m} normal (r={R})")
            axes[1, j].imshow(rows[1][1](m))
            axes[1, j].set_title(f"{m} lit preview")
        for ax in axes.ravel():
            ax.set_xticks([]); ax.set_yticks([])
        fig.suptitle(mat.replace("_", " "))
        fig.tight_layout()
        fig.savefig(f"{OUT}/fig_montage_{mat}.png", dpi=110)
        plt.close(fig)

        # height-diff debug comparison
        fig, axes = plt.subplots(1, 2, figsize=(8, 4))
        for ax, m in zip(axes, ["central", "adaptive"]):
            ax.imshow(img(f"{OUT}/debug/{mat}_{m}_r2_hdiff.png"))
            ax.set_title(f"{m} removed height (r={R})")
            ax.set_xticks([]); ax.set_yticks([])
        fig.tight_layout()
        fig.savefig(f"{OUT}/fig_hdiff_{mat}.png", dpi=110)
        plt.close(fig)
    print("montages written")


if __name__ == "__main__":
    main()
