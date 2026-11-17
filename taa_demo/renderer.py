"""Minimal numpy software rasterizer producing color + linear view depth.

Camera convention: right-handed view space, camera looks down -Z.
Projection is GL-style perspective; sub-pixel jitter is applied by
offsetting the projection matrix (standard TAA jitter).
"""
import numpy as np


def halton(index, base):
    f, r, i = 1.0, 0.0, index
    while i > 0:
        f /= base
        r += f * (i % base)
        i //= base
    return r


def jitter_sequence(n):
    """Halton(2,3) sub-pixel jitters in [-0.5, 0.5]."""
    return np.array([(halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5)
                     for i in range(n)], dtype=np.float64)


class Camera:
    def __init__(self, eye, yaw_deg, pitch_deg, fov_y_deg=60.0, near=0.1, far=100.0):
        self.eye = np.asarray(eye, dtype=np.float64)
        self.yaw = np.radians(yaw_deg)
        self.pitch = np.radians(pitch_deg)
        self.fov_y = np.radians(fov_y_deg)
        self.near = near
        self.far = far

    def view_matrix(self):
        cy, sy = np.cos(self.yaw), np.sin(self.yaw)
        cp, sp = np.cos(self.pitch), np.sin(self.pitch)
        fwd = np.array([sy * cp, sp, -cy * cp])
        right = np.array([cy, 0.0, sy])
        up = np.cross(right, fwd)
        V = np.eye(4)
        V[0, :3], V[1, :3], V[2, :3] = right, up, -fwd
        V[:3, 3] = -V[:3, :3] @ self.eye
        return V

    def proj_matrix(self, aspect, jitter_px=(0.0, 0.0), res=(1, 1)):
        f = 1.0 / np.tan(self.fov_y / 2.0)
        P = np.zeros((4, 4))
        P[0, 0] = f / aspect
        P[1, 1] = f
        P[2, 2] = (self.far + self.near) / (self.near - self.far)
        P[2, 3] = 2 * self.far * self.near / (self.near - self.far)
        P[3, 2] = -1.0
        P[0, 2] = 2.0 * jitter_px[0] / res[0]
        P[1, 2] = 2.0 * jitter_px[1] / res[1]
        return P


def box_triangles(center, size, color, checker=0.0):
    """12 triangles of an axis-aligned box."""
    cx, cy, cz = center
    hx, hy, hz = (s / 2.0 for s in size)
    v = np.array([[cx + dx, cy + dy, cz + dz]
                  for dz in (-hz, hz) for dy in (-hy, hy) for dx in (-hx, hx)])
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
             (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    tris = []
    for a, b, c, d in faces:
        tris += [(a, b, c), (a, c, d)]
    pos = np.array([[v[i] for i in t] for t in tris])
    col = np.tile(np.asarray(color, dtype=np.float64), (len(tris), 1))
    chk = np.full(len(tris), checker)
    return pos, col, chk


class Mesh:
    def __init__(self):
        self.pos = np.zeros((0, 3, 3))
        self.color = np.zeros((0, 3))
        self.checker = np.zeros(0)

    def add_box(self, center, size, color, checker=0.0):
        p, c, k = box_triangles(center, size, color, checker)
        self.pos = np.concatenate([self.pos, p])
        self.color = np.concatenate([self.color, c])
        self.checker = np.concatenate([self.checker, k])
        return self


def rasterize(mesh, cam, W, H, jitter_px=(0.0, 0.0)):
    """Returns color (H,W,3), view depth (H,W), tri-id map (H,W)."""
    V = cam.view_matrix()
    P = cam.proj_matrix(W / H, jitter_px, (W, H))
    VP = P @ V
    pts = mesh.pos.reshape(-1, 3)
    n = len(pts)
    hom = np.concatenate([pts, np.ones((n, 1))], axis=1)
    view = hom @ V.T
    view_tris = view.reshape(-1, 3, 4)

    depth = np.full((H, W), cam.far)
    attr = np.zeros((H, W, 3))  # perspective-correct world position
    tid = np.full((H, W), -1, dtype=np.int32)
    world = mesh.pos

    for t in range(len(view_tris)):
        vt = view_tris[t, :, :3]
        # clip triangle against the near plane z = -near (keep z <= -near)
        clipped_v, clipped_w = [], []
        wt = world[t]
        for k in range(3):
            a, b = vt[k], vt[(k + 1) % 3]
            wa, wb = wt[k], wt[(k + 1) % 3]
            da, db = -a[2] - cam.near, -b[2] - cam.near
            if da >= 0:
                clipped_v.append(a)
                clipped_w.append(wa)
            if (da >= 0) != (db >= 0):
                s = da / (da - db)
                clipped_v.append(a + s * (b - a))
                clipped_w.append(wa + s * (wb - wa))
        if len(clipped_v) < 3:
            continue
        vv = np.array(clipped_v)
        ww = np.array(clipped_w)
        clip = np.concatenate([vv, np.ones((len(vv), 1))], axis=1) @ P.T
        w = clip[:, 3]
        ndc = clip[:, :2] / w[:, None]
        px = (ndc[:, 0] * 0.5 + 0.5) * W
        py = (0.5 - ndc[:, 1] * 0.5) * H
        screen = np.stack([px, py], axis=1)
        # fan-triangulate the clipped polygon (3 or 4 vertices)
        for k in range(1, len(vv) - 1):
            idx = (0, k, k + 1)
            _fill_triangle(screen[list(idx)], vv[list(idx)], ww[list(idx)],
                           w[list(idx)], cam, W, H, depth, attr, tid, t)

    color = shade(mesh, cam, attr, depth, tid)
    return color, depth, tid


def _fill_triangle(screen, vv, ww, w, cam, W, H, depth, attr, tid, t):
    (x0, y0), (x1, y1), (x2, y2) = screen
    minx = max(int(np.floor(min(x0, x1, x2))), 0)
    maxx = min(int(np.ceil(max(x0, x1, x2))), W - 1)
    miny = max(int(np.floor(min(y0, y1, y2))), 0)
    maxy = min(int(np.ceil(max(y0, y1, y2))), H - 1)
    if minx > maxx or miny > maxy:
        return
    d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if abs(d) < 1e-12:
        return
    xs = np.arange(minx, maxx + 1) + 0.5
    ys = np.arange(miny, maxy + 1) + 0.5
    gx, gy = np.meshgrid(xs, ys)
    l0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / d
    l1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / d
    l2 = 1.0 - l0 - l1
    inside = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
    if not inside.any():
        return
    iw = 1.0 / w
    den = l0 * iw[0] + l1 * iw[1] + l2 * iw[2]
    b0, b1, b2 = l0 * iw[0] / den, l1 * iw[1] / den, l2 * iw[2] / den
    wp = (b0[..., None] * ww[0] + b1[..., None] * ww[1]
          + b2[..., None] * ww[2])
    vp = (b0[..., None] * vv[0] + b1[..., None] * vv[1]
          + b2[..., None] * vv[2])
    z = -vp[..., 2]
    sub_d = depth[miny:maxy + 1, minx:maxx + 1]
    upd = inside & (z < sub_d)
    if not upd.any():
        return
    sub_d[upd] = z[upd]
    sub_a = attr[miny:maxy + 1, minx:maxx + 1]
    sub_a[upd] = wp[upd]
    sub_t = tid[miny:maxy + 1, minx:maxx + 1]
    sub_t[upd] = t


def shade(mesh, cam, world, depth, tid):
    H, W = depth.shape
    hit = depth < cam.far
    gx = np.zeros_like(world)
    gy = np.zeros_like(world)
    gx[:, 1:-1] = world[:, 2:] - world[:, :-2]
    gy[1:-1, :] = world[2:, :] - world[:-2, :]
    nrm = np.cross(gx.reshape(-1, 3), gy.reshape(-1, 3)).reshape(H, W, 3)
    ln = np.linalg.norm(nrm, axis=2, keepdims=True)
    nrm = np.divide(nrm, np.where(ln < 1e-12, 1.0, ln))
    light = np.array([0.4, 0.8, 0.45])
    light /= np.linalg.norm(light)
    lam = np.abs((nrm * light).sum(2)) * 0.75 + 0.25

    base = np.ones((H, W, 3))
    checker = np.zeros((H, W))
    valid = tid >= 0
    base[valid] = mesh.color[tid[valid]]
    checker[valid] = mesh.checker[tid[valid]]
    an = np.abs(nrm)
    dom = an.argmax(2)
    u = np.where(dom == 0, world[..., 1], world[..., 0])
    v = np.where(dom == 2, world[..., 1], world[..., 2])
    v = np.where(dom == 0, world[..., 2], v)
    s = np.maximum(checker, 1e-6)
    pat = (np.floor(u * s).astype(int) + np.floor(v * s).astype(int)) % 2
    cfac = np.where(checker > 0, np.where(pat == 0, 1.0, 0.25), 1.0)
    color = base * cfac[..., None] * lam[..., None]
    color[~hit] = 0.05
    return np.clip(color, 0.0, 1.0)
