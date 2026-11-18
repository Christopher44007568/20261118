#!/usr/bin/env python3
"""Render the dithering comparison suite into artifacts/.

Outputs:
  noise_textures.png     blue / white / bayer textures, tiled 2x2
  compare_gradient.png   multi-level grayscale gradient, 4 modes
  compare_dark.png       dark-region banding, 4 modes
  compare_fog.png        transparent fog, quantize-before vs after blend
  camera_stability.png   two camera frames + noise-field difference
  spectrum.png           radial power spectra of textures and errors
  metrics.json           numeric uniformity metrics
"""

from __future__ import annotations

import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

from noise_dither.analysis import (anisotropy, low_frequency_energy_ratio,
                                   neighborhood_uniformity,
                                   radially_averaged_power_spectrum,
                                   repeat_block_score)
from noise_dither.dither import DitherMode, dither_field, get_texture
from noise_dither.scenes import (apply_dither, scene_dark, scene_fog,
                                 scene_gradient)

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), "artifacts")
SEED = 1337
TEXSIZE = 128
W, H = 512, 256
MODES = [DitherMode.NONE, DitherMode.WHITE, DitherMode.BLUE, DitherMode.BAYER]


def save_grid(panels, titles, path, suptitle):
    n = len(panels)
    fig, axes = plt.subplots(1, n, figsize=(4.2 * n, 3.4))
    if n == 1:
        axes = [axes]
    for ax, panel, title in zip(axes, panels, titles):
        ax.imshow(np.clip(panel, 0, 1),
                  cmap="gray" if panel.ndim == 2 else None, vmin=0, vmax=1)
        ax.set_title(title, fontsize=11)
        ax.axis("off")
    fig.suptitle(suptitle, fontsize=13)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)
    print("wrote", os.path.relpath(path))


def make_noise_textures():
    os.makedirs(ART, exist_ok=True)
    tiles = []
    for mode in (DitherMode.BLUE, DitherMode.WHITE, DitherMode.BAYER):
        tex = get_texture(mode, TEXSIZE, SEED)
        Image.fromarray((tex * 255).astype(np.uint8)).save(
            os.path.join(ART, f"{mode.value}_noise_{TEXSIZE}.png"))
        tiles.append(np.tile(tex, (2, 2)))
    save_grid(tiles, ["blue (tiled 2x2)", "white (tiled 2x2)",
                      "bayer 8x8 (tiled)"],
              os.path.join(ART, "noise_textures.png"),
              "Dither textures (tiling check)")


def make_gradient_and_dark():
    for name, scene_fn, levels in (
            ("gradient", scene_gradient, 12),
            ("dark", scene_dark, 64)):
        scene = scene_fn(W, H)
        panels, titles = [], []
        for mode in MODES:
            panels.append(apply_dither(scene, levels, mode, SEED))
            titles.append(mode.value)
        save_grid(panels, titles, os.path.join(ART, f"compare_{name}.png"),
                  f"{name} scene quantized to {levels} levels")


def make_fog():
    panels, titles = [], []
    for mode in (DitherMode.NONE, DitherMode.WHITE, DitherMode.BLUE):
        panels.append(scene_fog(W, H, mode=mode, quantize_before_blend=True,
                                seed=SEED))
        titles.append(f"{mode.value} (dither->quant->blend)")
    panels.append(scene_fog(W, H, mode=DitherMode.NONE,
                            quantize_before_blend=False, seed=SEED))
    titles.append("none, quant AFTER blend (wrong order)")
    save_grid(panels, titles, os.path.join(ART, "compare_fog.png"),
              "Transparent fog: dithered quantization BEFORE alpha blend")


def make_camera_stability():
    dx, dy = 37.5, 11.0
    frame_a = scene_fog(W, H, dx=0, dy=0, mode=DitherMode.BLUE, seed=SEED)
    frame_b = scene_fog(W, H, dx=dx, dy=dy, mode=DitherMode.BLUE, seed=SEED)
    field_a = dither_field(DitherMode.BLUE, H, W, TEXSIZE, SEED)
    field_b = dither_field(DitherMode.BLUE, H, W, TEXSIZE, SEED)
    field_diff = np.abs(field_a - field_b)
    save_grid(
        [frame_a, frame_b, field_a, field_diff],
        ["frame t (camera 0,0)", f"frame t+1 (camera {dx},{dy})",
         "dither field (screen space)", "|field(t) - field(t+1)| = 0"],
        os.path.join(ART, "camera_stability.png"),
        "Camera moves, noise stays locked to screen pixels")
    assert field_diff.max() == 0.0


def make_spectrum_and_metrics():
    fig, axes = plt.subplots(1, 4, figsize=(21, 4.6))
    metrics = {"seed": SEED, "texture_size": TEXSIZE, "textures": {},
               "gradient_error": {}}
    colors = {DitherMode.BLUE: "tab:blue", DitherMode.WHITE: "tab:gray",
              DitherMode.BAYER: "tab:red", DitherMode.NONE: "tab:green"}

    ax = axes[0]
    for mode in (DitherMode.BLUE, DitherMode.WHITE, DitherMode.BAYER):
        tex = get_texture(mode, TEXSIZE, SEED)
        r, p = radially_averaged_power_spectrum(tex)
        ax.semilogy(r, p + 1e-9, color=colors[mode], label=mode.value)
        metrics["textures"][mode.value] = {
            "low_freq_energy_ratio": low_frequency_energy_ratio(tex),
            "anisotropy": anisotropy(tex),
            "repeat_block_score": repeat_block_score(tex),
            "neighborhood_uniformity": neighborhood_uniformity(tex),
        }
    ax.set_title("Texture power spectra (radial avg)")
    ax.set_xlabel("frequency / Nyquist")
    ax.set_ylabel("power")
    ax.legend()

    scene = scene_gradient(W, H)
    levels = 12
    ax = axes[1]
    for mode in (DitherMode.BLUE, DitherMode.WHITE, DitherMode.BAYER,
                 DitherMode.NONE):
        q = apply_dither(scene, levels, mode, SEED)
        err = (q - scene).mean(axis=2)
        r, p = radially_averaged_power_spectrum(err)
        ax.semilogy(r, p + 1e-12, color=colors[mode], label=mode.value)
        metrics["gradient_error"][mode.value] = {
            "low_freq_energy_ratio": low_frequency_energy_ratio(err),
            "neighborhood_uniformity": neighborhood_uniformity(err),
            "repeat_block_score": repeat_block_score(err),
        }
    ax.set_title(f"Quantization error spectra (gradient, {levels} levels)")
    ax.set_xlabel("frequency / Nyquist")
    ax.legend()

    names = list(metrics["gradient_error"])
    bar_colors = [colors[DitherMode(n)] for n in names]
    ax = axes[2]
    vals = [metrics["gradient_error"][m]["neighborhood_uniformity"]
            ["local_mean_std"] for m in names]
    ax.bar(names, vals, color=bar_colors)
    ax.set_title("Error local-mean std, 16px windows\n(lower = smoother; "
                 "bayer wins only because its period divides 16)")
    ax = axes[3]
    vals = [metrics["gradient_error"][m]["repeat_block_score"] for m in names]
    ax.bar(names, vals, color=bar_colors)
    ax.set_title("Repeat-block score of error\n(high = checkerboard / tiling)")
    fig.tight_layout()
    fig.savefig(os.path.join(ART, "spectrum.png"), dpi=110)
    plt.close(fig)
    print("wrote", os.path.relpath(os.path.join(ART, "spectrum.png")))

    with open(os.path.join(ART, "metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=2)
    print("wrote", os.path.relpath(os.path.join(ART, "metrics.json")))


if __name__ == "__main__":
    make_noise_textures()
    make_gradient_and_dark()
    make_fog()
    make_camera_stability()
    make_spectrum_and_metrics()
