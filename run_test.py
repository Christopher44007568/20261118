"""Test harness: run FXAA on all scenes, report PSNR, save visualizations.

Outputs (in output/):
  <scene>_input.png    aliased 1x render (the post-processing input)
  <scene>_mask.png     edge mask: red = horizontal edge, blue = vertical,
                       brightness = blend amount actually applied
  <scene>_fxaa.png     FXAA result
  <scene>_gt.png       supersampled ground truth
  comparison.png       full-size grid of the above for every scene
  zoom.png             4x nearest-neighbour crops for close inspection
  psnr_report.txt      PSNR table (also printed to stdout)
"""

import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

import fxaa
import scenes

SIZE = 256
OUT = "output"


def psnr(a, b):
    mse = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    if mse <= 1e-12:
        return float("inf")
    return 10.0 * np.log10(1.0 / mse)


def save_png(path, img):
    arr = (np.clip(img, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    Image.fromarray(arr).save(path)


def mask_image(debug):
    """Colour-coded edge mask: red = horizontal edge, blue = vertical."""
    blend = debug["blend"]
    mask = np.zeros((*blend.shape, 3), dtype=np.float32)
    mask[..., 0] = np.where(debug["horz_span"], blend, 0.0)
    mask[..., 2] = np.where(~debug["horz_span"], blend, 0.0)
    return np.clip(mask * 2.0, 0.0, 1.0)  # boost for visibility


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    print(f"{'scene':<10} {'PSNR before':>12} {'PSNR after':>12} {'delta':>8}")
    print("-" * 46)
    for name, fn in scenes.SCENES.items():
        aliased, gt = scenes.render_pair(fn, size=SIZE)
        result, debug = fxaa.fxaa(aliased)
        p_before = psnr(aliased, gt)
        p_after = psnr(result, gt)
        rows.append((name, aliased, mask_image(debug), result, gt,
                     p_before, p_after))
        print(f"{name:<10} {p_before:>11.2f}  {p_after:>11.2f}  "
              f"{p_after - p_before:>+7.2f}")
        save_png(os.path.join(OUT, f"{name}_input.png"), aliased)
        save_png(os.path.join(OUT, f"{name}_mask.png"), rows[-1][2])
        save_png(os.path.join(OUT, f"{name}_fxaa.png"), result)
        save_png(os.path.join(OUT, f"{name}_gt.png"), gt)

    with open(os.path.join(OUT, "psnr_report.txt"), "w") as fh:
        fh.write(f"{'scene':<10} {'PSNR before':>12} {'PSNR after':>12} {'delta':>8}\n")
        for r in rows:
            fh.write(f"{r[0]:<10} {r[5]:>11.2f}  {r[6]:>11.2f}  "
                     f"{r[6] - r[5]:>+7.2f}\n")

    titles = ["Aliased input", "Edge mask", "FXAA result", "Ground truth"]
    fig, axes = plt.subplots(len(rows), 4, figsize=(16, 4 * len(rows)))
    for i, (name, aliased, mask, result, gt, pb, pa) in enumerate(rows):
        for j, img in enumerate((aliased, mask, result, gt)):
            ax = axes[i, j]
            ax.imshow(np.clip(img, 0, 1), interpolation="nearest")
            ax.set_xticks([])
            ax.set_yticks([])
            if i == 0:
                ax.set_title(titles[j])
        axes[i, 0].set_ylabel(f"{name}\n{pb:.1f} -> {pa:.1f} dB")
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "comparison.png"), dpi=110)
    plt.close(fig)

    # Zoomed crops (4x nearest) around a busy region of each scene.
    crops = {"grid": (96, 96, 64), "railings": (96, 96, 64),
             "gradient": (96, 96, 64), "text": (24, 8, 96)}
    fig, axes = plt.subplots(len(rows), 3, figsize=(12, 4 * len(rows)))
    for i, (name, aliased, mask, result, gt, pb, pa) in enumerate(rows):
        cy, cx, cs = crops[name]
        for j, img in enumerate((aliased, result, gt)):
            crop = img[cy:cy + cs, cx:cx + cs]
            crop = np.repeat(np.repeat(crop, 4, 0), 4, 1)
            ax = axes[i, j]
            ax.imshow(np.clip(crop, 0, 1), interpolation="nearest")
            ax.set_xticks([])
            ax.set_yticks([])
            if i == 0:
                ax.set_title(["Aliased input", "FXAA result", "Ground truth"][j])
        axes[i, 0].set_ylabel(name)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "zoom.png"), dpi=110)
    plt.close(fig)
    print(f"\nImages and report written to {OUT}/")


if __name__ == "__main__":
    main()
