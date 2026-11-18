"""Mesh export helpers (OBJ / STL)."""
import struct

import numpy as np


def export_obj(path, vertices, normals, faces):
    """Write Wavefront OBJ with vertex normals. Faces are 1-based."""
    with open(path, "w") as fh:
        fh.write("# marching cubes export\n")
        for v in vertices:
            fh.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
        for n in normals:
            fh.write(f"vn {n[0]:.6f} {n[1]:.6f} {n[2]:.6f}\n")
        for f in faces:
            a, b, c = f + 1
            fh.write(f"f {a}//{a} {b}//{b} {c}//{c}\n")
    return path


def export_stl(path, vertices, faces):
    """Write binary STL (normals recomputed per facet)."""
    tris = vertices[faces]
    fn = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    norm = np.linalg.norm(fn, axis=1)
    norm[norm == 0.0] = 1.0
    fn = fn / norm[:, None]
    with open(path, "wb") as fh:
        fh.write(b"\0" * 80)
        fh.write(struct.pack("<I", len(tris)))
        for i, tri in enumerate(tris):
            fh.write(struct.pack("<3f", *fn[i].astype(np.float32)))
            for v in tri:
                fh.write(struct.pack("<3f", *v.astype(np.float32)))
            fh.write(struct.pack("<H", 0))
    return path
