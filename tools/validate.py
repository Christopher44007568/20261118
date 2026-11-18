"""Validation suite for the Marching Cubes extractor.

Checks per field: duplicate vertices, degenerate triangles, closedness,
orientation (no inverted triangles), boundary normal fill-in, silhouette
contour extents, and OBJ/STL export round-trips.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mcubes_app.fields import load_field, _grid
from mcubes_app.marching_cubes import marching_cubes
from mcubes_app.meshio import export_obj, export_stl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPORT_DIR = os.path.join(ROOT, "artifacts", "exports")
PREVIEW_DIR = os.path.join(ROOT, "artifacts", "previews")

PASS, FAIL = "PASS", "FAIL"
failures = []


def check(name, ok, detail=""):
    tag = PASS if ok else FAIL
    if not ok:
        failures.append(name)
    print(f"  [{tag}] {name}" + (f"  ({detail})" if detail else ""))


def mesh_stats(v, f):
    edges = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    return edges, counts


def validate_mesh(label, res, expect_closed=True):
    print(f"\n== {label} ==")
    v, n, f = res.vertices, res.normals, res.faces
    print(f"  vertices={len(v)} triangles={len(f)} "
          f"active_voxels={res.active_voxels} extract={res.elapsed_ms:.1f} ms")
    dup = len(v) - len(np.unique(np.round(v, 9), axis=0))
    check("no duplicate vertices", dup == 0, f"dup={dup}")
    degen = (f[:, 0] == f[:, 1]) | (f[:, 1] == f[:, 2]) | (f[:, 2] == f[:, 0])
    area2 = np.linalg.norm(np.cross(v[f[:, 1]] - v[f[:, 0]],
                                    v[f[:, 2]] - v[f[:, 0]]), axis=1)
    check("no degenerate triangles", not degen.any() and (area2 > 1e-12).all())
    _, counts = mesh_stats(v, f)
    n_boundary = int((counts == 1).sum())
    n_bad = int((counts > 2).sum())
    check("edge manifoldness (<=2 tris/edge)", n_bad == 0, f"bad={n_bad}")
    if expect_closed:
        check("closed surface (every edge x2)", n_boundary == 0,
              f"boundary_edges={n_boundary}")
    else:
        check("open surface has boundary loop", n_boundary > 0,
              f"boundary_edges={n_boundary}")
    vol = np.einsum("ij,ij->i", v[f[:, 0]],
                    np.cross(v[f[:, 1]], v[f[:, 2]])).sum() / 6.0
    check("positive signed volume (outward winding)", vol > 0, f"vol={vol:+.4f}")
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    agree = (fn * n[f].mean(axis=1)).sum(axis=1)
    n_inv = int((agree < 0).sum())
    check("no inverted triangles", n_inv == 0, f"inverted={n_inv}")
    nlen = np.linalg.norm(n, axis=1)
    check("vertex normals unit length",
          np.allclose(nlen, 1.0, atol=1e-6),
          f"min={nlen.min():.6f} max={nlen.max():.6f}")
    return v, n, f


def silhouette_radius(v, axis):
    proj = np.delete(v, axis, axis=1)
    return np.linalg.norm(proj, axis=1)


def check_silhouette_sphere(v, r_expected=1.0, tol=0.15):
    for axis, name in ((0, "x"), (1, "y"), (2, "z")):
        r = silhouette_radius(v, axis)
        ok = abs(r.max() - r_expected) < tol
        check(f"silhouette perp-{name}: radius~{r_expected}", ok,
              f"proj_r=[{r.min():.3f},{r.max():.3f}]")


def boundary_normal_check(n=48, radius=2.2):
    """Sphere larger than the sampling volume: the isosurface is clipped by
    the grid boundary, so boundary vertices must still get valid normals."""
    print("\n== boundary-clipped sphere (normal fill-in at volume boundary) ==")
    (x, y, z), origin, spacing = _grid(n)
    field = np.sqrt(x ** 2 + y ** 2 + z ** 2) - radius
    res = marching_cubes(field, 0.0, origin, spacing)
    v, nrm, f = res.vertices, res.normals, res.faces
    hi = 1.6
    on_bnd = np.any(np.abs(np.abs(v) - hi) < 1e-9, axis=1)
    check("surface touches volume boundary", on_bnd.sum() > 100,
          f"boundary_vertices={int(on_bnd.sum())}")
    nb = nrm[on_bnd]
    lens = np.linalg.norm(nb, axis=1)
    check("boundary normals unit length", np.allclose(lens, 1.0, atol=1e-6),
          f"min={lens.min():.6f}")
    radial = (nb * v[on_bnd]).sum(axis=1)
    check("boundary normals point outward", (radial > 0.9).all(),
          f"min dot={radial.min():.4f}")
    _, counts = mesh_stats(v, f)
    check("clipped mesh is open as expected", (counts == 1).sum() > 0)


def roundtrip_obj(path):
    vs, fs = [], []
    with open(path) as fh:
        for line in fh:
            if line.startswith("v "):
                vs.append([float(t) for t in line.split()[1:4]])
            elif line.startswith("f "):
                fs.append([int(t.split("//")[0]) - 1 for t in line.split()[1:4]])
    v = np.array(vs)
    f = np.array(fs, dtype=np.int64)
    _, counts = mesh_stats(v, f)
    check("OBJ round-trip: closed, no dup",
          (counts == 2).all()
          and len(v) == len(np.unique(np.round(v, 5), axis=0)))


def render_previews(cases):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    os.makedirs(PREVIEW_DIR, exist_ok=True)
    for name, res in cases.items():
        fig = plt.figure(figsize=(6, 6))
        ax = fig.add_subplot(111, projection="3d")
        if len(res.faces):
            poly = Poly3DCollection(res.vertices[res.faces], facecolor="#4c9be0",
                                    edgecolor="#16324a", linewidths=0.1, alpha=0.95)
            ax.add_collection3d(poly)
        ax.set_xlim(-1.6, 1.6)
        ax.set_ylim(-1.6, 1.6)
        ax.set_zlim(-1.6, 1.6)
        ax.set_box_aspect((1, 1, 1))
        ax.set_title(f"{name}  V={len(res.vertices)} T={len(res.faces)}")
        fig.savefig(os.path.join(PREVIEW_DIR, f"{name}.png"), dpi=110)
        plt.close(fig)
    print(f"\npreviews -> {PREVIEW_DIR}")


def main():
    os.makedirs(EXPORT_DIR, exist_ok=True)
    cases = {}
    for name in ("sphere", "double_sphere", "plane_cut"):
        label, field, origin, spacing, level0, _ = load_field(name, n=64)
        res = marching_cubes(field, level0, origin, spacing)
        cases[name] = res
        v, nrm, f = validate_mesh(f"{label} (iso={level0:+.2f})", res)
        if name == "sphere":
            check_silhouette_sphere(v, 1.0)
        elif name == "double_sphere":
            ext = v.max(axis=0) - v.min(axis=0)
            check("double-sphere elongated along x",
                  ext[0] > 1.4 * ext[1] and abs(ext[1] - ext[2]) < 0.2,
                  f"extent={np.round(ext, 3).tolist()}")
        elif name == "plane_cut":
            check("flat cap at x=0.25", abs(v[:, 0].min() - 0.25) < 0.08,
                  f"min_x={v[:, 0].min():.4f}")
            cap = v[np.abs(v[:, 0] - 0.25) < 0.05]
            check("cap vertices coplanar", len(cap) > 50,
                  f"cap_vertices={len(cap)}")
        obj = os.path.join(EXPORT_DIR, f"{name}.obj")
        stl = os.path.join(EXPORT_DIR, f"{name}.stl")
        export_obj(obj, res.vertices, res.normals, res.faces)
        export_stl(stl, res.vertices, res.faces)
        roundtrip_obj(obj)

    boundary_normal_check()
    render_previews(cases)

    print("\n" + ("ALL CHECKS PASSED" if not failures
                  else f"FAILURES: {failures}"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
