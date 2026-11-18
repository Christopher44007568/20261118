"""Interactive Marching Cubes viewer.

Drag the threshold slider to update vertices/triangles in real time.
The panel shows active voxels, output vertex/triangle counts and the
extraction time of the last run. Meshes can be exported as OBJ.

Usage:
    python3 -m mcubes_app.app [--grid N] [--field sphere|double_sphere|plane_cut]
"""
import argparse
import os
import time

import numpy as np
import matplotlib
import matplotlib.pyplot as plt
from matplotlib.widgets import Button, RadioButtons, Slider
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

from .fields import FIELDS, load_field
from .marching_cubes import marching_cubes
from .meshio import export_obj

EXPORT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          "artifacts", "exports")


class Viewer:
    def __init__(self, grid_n, field_name):
        self.grid_n = grid_n
        self.field_name = field_name
        self.level = None
        self.result = None
        self._load_field(field_name)

        self.fig = plt.figure(figsize=(11, 7.5))
        self.ax = self.fig.add_axes([0.02, 0.18, 0.72, 0.78], projection="3d")
        self.ax_slider = self.fig.add_axes([0.20, 0.08, 0.50, 0.03])
        self.ax_radio = self.fig.add_axes([0.78, 0.55, 0.20, 0.22])
        self.ax_export = self.fig.add_axes([0.78, 0.44, 0.20, 0.05])
        self.ax_stats = self.fig.add_axes([0.76, 0.18, 0.23, 0.24])
        self.ax_stats.axis("off")

        lo, hi = self.level_range
        self.slider = Slider(self.ax_slider, "threshold", lo, hi,
                             valinit=self.level0, valstep=(hi - lo) / 400)
        self.slider.on_changed(self.on_threshold)

        labels = [FIELDS[k][0] for k in FIELDS]
        self.radio = RadioButtons(self.ax_radio, labels,
                                  active=list(FIELDS).index(field_name))
        self.radio.on_clicked(self.on_field)

        self.btn_export = Button(self.ax_export, "Export OBJ")
        self.btn_export.on_clicked(self.on_export)

        self.stats_text = self.ax_stats.text(
            0.0, 1.0, "", va="top", family="monospace", fontsize=10)
        self.poly = None
        self.reextract(self.level0)

    def _load_field(self, name):
        label, field, origin, spacing, level0, level_range = load_field(name, self.grid_n)
        self.field_label = label
        self.field = field
        self.origin = origin
        self.spacing = spacing
        self.level0 = level0
        self.level_range = level_range

    def reextract(self, level):
        self.level = level
        t0 = time.perf_counter()
        self.result = marching_cubes(self.field, level, self.origin, self.spacing)
        self.result.elapsed_ms = (time.perf_counter() - t0) * 1e3
        self.redraw()

    def redraw(self):
        res = self.result
        if self.poly is not None:
            self.poly.remove()
            self.poly = None
        self.ax.clear()
        if len(res.faces):
            tris = res.vertices[res.faces]
            self.poly = Poly3DCollection(
                tris, facecolors="#4c9be0", edgecolors="#16324a",
                linewidths=0.15, alpha=0.95, shade=True)
            self.ax.add_collection3d(self.poly)
        lo, hi = -1.6, 1.6
        self.ax.set_xlim(lo, hi)
        self.ax.set_ylim(lo, hi)
        self.ax.set_zlim(lo, hi)
        self.ax.set_box_aspect((1, 1, 1))
        self.ax.set_title(
            f"{self.field_label}  iso={self.level:+.3f}", fontsize=11)
        self.stats_text.set_text(
            f"active voxels : {res.active_voxels}\n"
            f"vertices      : {len(res.vertices)}\n"
            f"triangles     : {len(res.faces)}\n"
            f"extract time  : {res.elapsed_ms:6.1f} ms\n"
            f"grid          : {self.grid_n}^3")
        self.fig.canvas.draw_idle()

    def on_threshold(self, value):
        self.reextract(value)

    def on_field(self, _label):
        name = list(FIELDS)[list(FIELDS).index(self.field_name)]
        for key, (label, _fn) in FIELDS.items():
            if label == _label:
                name = key
                break
        self.field_name = name
        self._load_field(name)
        lo, hi = self.level_range
        self.slider.valmin, self.slider.valmax = lo, hi
        self.slider.ax.set_xlim(lo, hi)
        self.slider.set_val(self.level0)
        self.reextract(self.level0)

    def on_export(self, _event):
        os.makedirs(EXPORT_DIR, exist_ok=True)
        path = os.path.join(
            EXPORT_DIR, f"{self.field_name}_iso{self.level:+.3f}.obj")
        export_obj(path, self.result.vertices, self.result.normals, self.result.faces)
        print(f"exported {path}")

    def show(self):
        plt.show()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grid", type=int, default=64, help="samples per axis")
    parser.add_argument("--field", default="sphere", choices=list(FIELDS))
    args = parser.parse_args()
    Viewer(args.grid, args.field).show()


if __name__ == "__main__":
    main()
