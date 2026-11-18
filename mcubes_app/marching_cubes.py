"""Vectorized Marching Cubes isosurface extraction.

Guarantees:
  * no duplicate vertices (shared grid edges are merged via unique edge ids)
  * consistent, outward-facing triangle winding (verified against gradients)
  * vertex normals from the field gradient; boundary cells use second-order
    one-sided differences so normals are filled in at the volume boundary
"""
import time
from dataclasses import dataclass, field as dc_field

import numpy as np

from .mc_tables import EDGE_TABLE, TRI_TABLE

EDGE_TABLE = np.asarray(EDGE_TABLE, dtype=np.int32)
TRI_TABLE = np.asarray(TRI_TABLE, dtype=np.int32)

# corner c -> (di, dj, dk) offset inside a cell, classic Bourke numbering:
# bottom face 0:(0,0,0) 1:(1,0,0) 2:(1,1,0) 3:(0,1,0), top face 4..7 (z=1)
CORNER_OFFSET = np.array(
    [[(c & 1) ^ ((c >> 1) & 1), (c >> 1) & 1, (c >> 2) & 1] for c in range(8)],
    dtype=np.int64,
)

# edge e -> (corner_a, corner_b) following the classic table order
EDGE_CORNERS = np.array(
    [(0, 1), (1, 2), (2, 3), (3, 0),
     (4, 5), (5, 6), (6, 7), (7, 4),
     (0, 4), (1, 5), (2, 6), (3, 7)],
    dtype=np.int64,
)
# edge e -> axis it runs along (0=x, 1=y, 2=z)
EDGE_AXIS = np.array([0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2], dtype=np.int64)
# edge e -> offset of its lowest grid vertex inside the cell
EDGE_BASE = np.array(
    [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 0],
     [0, 0, 1], [1, 0, 1], [0, 1, 1], [0, 0, 1],
     [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
    dtype=np.int64,
)


@dataclass
class MCResult:
    vertices: np.ndarray          # (N, 3) float64, world coordinates
    normals: np.ndarray           # (N, 3) float64, unit, outward
    faces: np.ndarray             # (M, 3) int64, counter-clockwise from outside
    active_voxels: int = 0
    elapsed_ms: float = 0.0
    level: float = 0.0
    stats: dict = dc_field(default_factory=dict)


def _field_gradient(field, spacing):
    """Gradient with 2nd-order one-sided differences at the boundary,
    so normals are well defined even for surface vertices lying on the
    outermost grid layer."""
    gx, gy, gz = np.gradient(field, *spacing, edge_order=2)
    return gx, gy, gz


def marching_cubes(field, level, origin=(0.0, 0.0, 0.0), spacing=(1.0, 1.0, 1.0)):
    """Extract the isosurface `field == level` (inside: field <= level)."""
    t0 = time.perf_counter()
    field = np.ascontiguousarray(field, dtype=np.float64)
    nx, ny, nz = field.shape
    if min(nx, ny, nz) < 2:
        raise ValueError("field must be at least 2x2x2")
    origin = np.asarray(origin, dtype=np.float64)
    spacing = np.asarray(spacing, dtype=np.float64)

    # ---- case index per cell -------------------------------------------
    inside = field <= level
    cubeindex = np.zeros((nx - 1, ny - 1, nz - 1), dtype=np.int32)
    for c in range(8):
        di, dj, dk = CORNER_OFFSET[c]
        cubeindex |= inside[di:di + nx - 1, dj:dj + ny - 1, dk:dk + nz - 1].astype(np.int32) << c

    active = (cubeindex != 0) & (cubeindex != 255)
    active_voxels = int(active.sum())

    edge_bits = EDGE_TABLE[cubeindex]  # (nx-1, ny-1, nz-1)

    # ---- one vertex per unique grid edge --------------------------------
    nnn = nx * ny * nz
    corner_vals = [field[di:di + nx - 1, dj:dj + ny - 1, dk:dk + nz - 1]
                   for di, dj, dk in CORNER_OFFSET]
    grads = _field_gradient(field, spacing)
    corner_grads = [tuple(g[di:di + nx - 1, dj:dj + ny - 1, dk:dk + nz - 1]
                          for g in grads) for di, dj, dk in CORNER_OFFSET]

    gid_list, pos_list, nrm_list = [], [], []
    cell_edge_gid = np.full(cubeindex.shape + (12,), -1, dtype=np.int64)

    for e in range(12):
        mask = active & ((edge_bits >> e) & 1).astype(bool)
        if not mask.any():
            continue
        ii, jj, kk = np.nonzero(mask)
        base = EDGE_BASE[e]
        gx, gy, gz = ii + base[0], jj + base[1], kk + base[2]
        gid = (EDGE_AXIS[e] * nnn
               + (gx.astype(np.int64) * ny + gy) * nz + gz)
        cell_edge_gid[ii, jj, kk, e] = gid

        ca, cb = EDGE_CORNERS[e]
        fa = corner_vals[ca][ii, jj, kk]
        fb = corner_vals[cb][ii, jj, kk]
        denom = fb - fa
        t = np.where(denom != 0.0, (level - fa) / np.where(denom == 0.0, 1.0, denom), 0.5)
        t = np.clip(t, 0.0, 1.0)

        pa = (np.stack([ii, jj, kk], axis=1) + CORNER_OFFSET[ca]) * spacing + origin
        pb = (np.stack([ii, jj, kk], axis=1) + CORNER_OFFSET[cb]) * spacing + origin
        pos = pa + t[:, None] * (pb - pa)

        ga = np.stack([corner_grads[ca][a][ii, jj, kk] for a in range(3)], axis=1)
        gb = np.stack([corner_grads[cb][a][ii, jj, kk] for a in range(3)], axis=1)
        nrm = ga + t[:, None] * (gb - ga)

        gid_list.append(gid)
        pos_list.append(pos)
        nrm_list.append(nrm)

    if not gid_list:
        elapsed = (time.perf_counter() - t0) * 1e3
        return MCResult(np.zeros((0, 3)), np.zeros((0, 3)),
                        np.zeros((0, 3), dtype=np.int64),
                        active_voxels=0, elapsed_ms=elapsed, level=level)

    all_gid = np.concatenate(gid_list)
    all_pos = np.concatenate(pos_list)
    all_nrm = np.concatenate(nrm_list)

    uniq_gid, first = np.unique(all_gid, return_index=True)
    vertices = all_pos[first]
    normals = all_nrm[first]
    nlen = np.linalg.norm(normals, axis=1)
    nlen[nlen == 0.0] = 1.0
    normals = normals / nlen[:, None]

    # ---- triangles -------------------------------------------------------
    ai, aj, ak = np.nonzero(active)
    cases = cubeindex[ai, aj, ak]
    cell_vid = np.searchsorted(uniq_gid, cell_edge_gid[ai, aj, ak])  # (A, 12)

    tri_edges = TRI_TABLE[cases]                     # (A, 16)
    valid = tri_edges >= 0
    flat_edges = np.where(valid, tri_edges, 0)
    # gather: cell_vid is (A,12); want (A,16) with cell_vid[a, tri_edges[a,m]]
    a_idx = np.arange(len(cases))[:, None]
    tri_vid = cell_vid[a_idx, flat_edges]
    tri_vid = np.where(valid, tri_vid, -1)

    tris = tri_vid[:, :15].reshape(len(cases), 5, 3)
    good = (tris >= 0).all(axis=2)
    faces = tris[good]

    # enforce outward winding: face normal must agree with avg vertex normal
    if len(faces):
        v0 = vertices[faces[:, 0]]
        v1 = vertices[faces[:, 1]]
        v2 = vertices[faces[:, 2]]
        fn = np.cross(v1 - v0, v2 - v0)
        vn = normals[faces].mean(axis=1)
        flip = (fn * vn).sum(axis=1) < 0
        faces[flip] = faces[flip][:, ::-1]

    elapsed = (time.perf_counter() - t0) * 1e3
    return MCResult(vertices, normals, faces,
                    active_voxels=active_voxels, elapsed_ms=elapsed, level=level)
