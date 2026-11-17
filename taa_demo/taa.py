"""Temporal anti-aliasing with history color buffer.

Keeps previous-frame color, depth and camera matrices. Each frame:
  1. unproject current pixel using current depth + unjittered VP
  2. reproject into the previous frame with the previous VP
  3. accept history only when in-bounds and depth-consistent
  4. clamp history to the 3x3 neighborhood of the current frame
  5. blend: accepted -> small alpha (converges), rejected -> full current
"""
import numpy as np


def _bilinear(img, xs, ys):
    H, W = img.shape[:2]
    x0 = np.clip(np.floor(xs).astype(int), 0, W - 1)
    y0 = np.clip(np.floor(ys).astype(int), 0, H - 1)
    x1 = np.clip(x0 + 1, 0, W - 1)
    y1 = np.clip(y0 + 1, 0, H - 1)
    fx = np.clip(xs - x0, 0, 1)
    fy = np.clip(ys - y0, 0, 1)
    if img.ndim == 3:
        fx, fy = fx[..., None], fy[..., None]
    c00 = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    c01 = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    return c00 * (1 - fy) + c01 * fy


def _nearest(img, xs, ys):
    H, W = img.shape[:2]
    xi = np.clip(np.round(xs).astype(int), 0, W - 1)
    yi = np.clip(np.round(ys).astype(int), 0, H - 1)
    return img[yi, xi]


def _neighborhood_minmax(color):
    lo = color.copy()
    hi = color.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            s = np.roll(np.roll(color, dy, 0), dx, 1)
            lo = np.minimum(lo, s)
            hi = np.maximum(hi, s)
    return lo, hi


class TAA:
    def __init__(self, width, height, alpha=0.1, depth_tol=0.05):
        self.W, self.H = width, height
        self.alpha = alpha          # current-frame weight when history valid
        self.depth_tol = depth_tol  # relative depth tolerance for disocclusion
        self.history_color = None
        self.history_depth = None
        self.prev_V = None
        self.prev_P = None          # unjittered projection of previous frame

    @property
    def has_history(self):
        return self.history_color is not None

    def process(self, color, depth, V, P_unjittered, jitter_px, naive=False):
        """Returns (output, stats). `naive` disables all rejection/clamping
        (ghosting baseline for comparison)."""
        H, W = self.H, self.W
        if not self.has_history:
            out = color.copy()
            stats = dict(valid_ratio=0.0, rejected_ratio=0.0, first_frame=True)
        else:
            ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
            # unjittered NDC of pixel centers: rendered_ndc = ideal - jitter,
            # so recovering the ideal (unjittered) position adds the offset
            ndc_x = (xs + 0.5) / W * 2.0 - 1.0 + 2.0 * jitter_px[0] / W
            ndc_y = 1.0 - (ys + 0.5) / H * 2.0 + 2.0 * jitter_px[1] / H
            # view-space position from linear depth (camera looks down -Z)
            f = P_unjittered[1, 1]
            aspect_scale = P_unjittered[0, 0]
            vx = ndc_x / aspect_scale * depth
            vy = ndc_y / f * depth
            vz = -depth
            # view -> world (V is rigid: world = R^T @ (view - t_row))
            R = V[:3, :3]
            t = V[:3, 3]
            vw = np.stack([vx, vy, vz], -1) - t
            world = vw @ R  # R^T applied via right-multiply
            # world -> previous clip -> previous pixel
            VP_prev = self.prev_P @ self.prev_V
            hom = np.concatenate([world, np.ones((H, W, 1))], -1)
            clip = hom @ VP_prev.T
            w = clip[..., 3]
            safe_w = np.where(np.abs(w) < 1e-9, 1e-9, w)
            pxs = (clip[..., 0] / safe_w * 0.5 + 0.5) * W - 0.5
            pys = (0.5 - clip[..., 1] / safe_w * 0.5) * H - 0.5
            # expected depth in previous view space
            pv = hom @ self.prev_V.T
            expected = -pv[..., 2]

            in_bounds = ((pxs >= 0) & (pxs <= W - 1) &
                         (pys >= 0) & (pys <= H - 1) & (w > 0))
            hist_depth = _nearest(self.history_depth, pxs, pys)
            depth_ok = (np.abs(hist_depth - expected)
                        <= self.depth_tol * np.maximum(expected, 1e-3))
            valid = in_bounds & depth_ok

            hist_col = _bilinear(self.history_color, pxs, pys)
            if naive:
                out = self.alpha * color + (1 - self.alpha) * hist_col
                out = np.where(in_bounds[..., None], out, color)
            else:
                lo, hi = _neighborhood_minmax(color)
                hist_clamped = np.clip(hist_col, lo, hi)
                a = np.where(valid, self.alpha, 1.0)[..., None]
                out = a * color + (1 - a) * hist_clamped
            stats = dict(valid_ratio=float(valid.mean()),
                         rejected_ratio=float((~valid).mean()),
                         first_frame=False)

        self.history_color = out.copy()
        self.history_depth = depth.copy()
        self.prev_V = V.copy()
        self.prev_P = P_unjittered.copy()
        return np.clip(out, 0.0, 1.0), stats
