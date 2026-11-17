"""FXAA (Fast Approximate Anti-Aliasing) post-processing, numpy reference port.

Implements the FXAA 3.11 "quality" algorithm by Timothy Lottes (NVIDIA):
local luma contrast gating, horizontal/vertical edge classification,
edge-end search along the edge, and a sub-pixel blend across the edge.
Low-contrast pixels pass through untouched so smooth gradients and fine
interior detail are preserved.

All functions operate on float32 RGB images in [0, 1], shape (H, W, 3).
"""

import numpy as np

LUMA_WEIGHTS = np.array([0.299, 0.587, 0.114], dtype=np.float32)

# FXAA quality preset search step sizes along the edge.
QUALITY_STEPS = (1.0, 1.0, 1.0, 1.0, 1.5, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0)


def rgb_to_luma(img):
    return img.astype(np.float32) @ LUMA_WEIGHTS


def _bilinear(img, xs, ys):
    """Sample img (H,W) or (H,W,C) at float pixel coords (xs, ys)."""
    h, w = img.shape[:2]
    xs = np.clip(xs, 0.0, w - 1.0)
    ys = np.clip(ys, 0.0, h - 1.0)
    x0 = np.floor(xs).astype(np.int32)
    y0 = np.floor(ys).astype(np.int32)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    fx = (xs - x0).astype(np.float32)
    fy = (ys - y0).astype(np.float32)
    c00 = img[y0, x0]
    c10 = img[y0, x1]
    c01 = img[y1, x0]
    c11 = img[y1, x1]
    wa = (1.0 - fx) * (1.0 - fy)
    wb = fx * (1.0 - fy)
    wc = (1.0 - fx) * fy
    wd = fx * fy
    if img.ndim == 3:
        wa, wb, wc, wd = (a[..., None] for a in (wa, wb, wc, wd))
    return c00 * wa + c10 * wb + c01 * wc + c11 * wd


def _luma_neighborhood(luma):
    """Return the 3x3 luma neighborhood as nine (H, W) arrays."""
    h, w = luma.shape
    pad = np.pad(luma, 1, mode="edge")
    return (
        pad[0:h, 0:w], pad[0:h, 1 : w + 1], pad[0:h, 2 : w + 2],
        pad[1 : h + 1, 0:w], pad[1 : h + 1, 1 : w + 1], pad[1 : h + 1, 2 : w + 2],
        pad[2 : h + 2, 0:w], pad[2 : h + 2, 1 : w + 1], pad[2 : h + 2, 2 : w + 2],
    )


def fxaa(img, subpix=0.75, edge_threshold=0.125, edge_threshold_min=0.0312,
         thin_line_keep=0.25):
    """Run FXAA on an RGB image.

    Returns (result, debug) where debug holds:
      blend      (H, W) final sub-pixel blend amount actually applied
      horz_span  (H, W) bool, True where the detected edge runs horizontally
      early_exit (H, W) bool, True where the contrast test skipped the pixel
      thin_line  (H, W) bool, True where the pixel is a 1px ridge/ravine

    thin_line_keep scales the sub-pixel blend on 1px ridge/ravine pixels so
    thin lines and strokes are smoothed by their neighbours but not erased.
    """
    src = np.ascontiguousarray(img, dtype=np.float32)
    h, w = src.shape[:2]
    luma = rgb_to_luma(src)
    l_nw, l_n, l_ne, l_w, l_m, l_e, l_sw, l_s, l_se = _luma_neighborhood(luma)

    # Local contrast test: low-contrast pixels are left untouched.
    nb_min = np.minimum(np.minimum(np.minimum(l_n, l_s), np.minimum(l_e, l_w)), l_m)
    nb_max = np.maximum(np.maximum(np.maximum(l_n, l_s), np.maximum(l_e, l_w)), l_m)
    rng = nb_max - nb_min
    threshold = np.maximum(edge_threshold_min, nb_max * edge_threshold)
    early_exit = rng < threshold
    safe_rng = np.maximum(rng, 1e-6)

    # Edge direction: does the edge run horizontally or vertically?
    l_ns = l_n + l_s
    l_we = l_w + l_e
    edge_h = (np.abs(-2.0 * l_m + l_ns) * 2.0 + np.abs(-2.0 * l_e + l_ne + l_se)
              + np.abs(-2.0 * l_w + l_nw + l_sw))
    edge_v = (np.abs(-2.0 * l_m + l_we) * 2.0 + np.abs(-2.0 * l_n + l_nw + l_ne)
              + np.abs(-2.0 * l_s + l_sw + l_se))
    horz_span = edge_h >= edge_v

    # Sub-pixel aliasing factor (keeps thin lines dimmed, not erased).
    subpix_a = (l_ns + l_we) * 2.0 + (l_nw + l_sw + l_ne + l_se)
    subpix_b = subpix_a * (1.0 / 12.0) - l_m
    subpix_c = np.clip(np.abs(subpix_b) / safe_rng, 0.0, 1.0)
    subpix_f = ((-2.0 * subpix_c + 3.0) * subpix_c * subpix_c) * subpix

    # Thin-line guard: if the centre pixel is an extremum across the edge
    # perpendicular (a 1px ridge or ravine), strongly attenuate the
    # sub-pixel blend so the line keeps its contrast.
    cross_a = np.where(horz_span, l_n, l_w)
    cross_b = np.where(horz_span, l_s, l_e)
    ridge = (l_m > cross_a) & (l_m > cross_b)
    ravine = (l_m < cross_a) & (l_m < cross_b)
    thin_line = ridge | ravine
    subpix_f = np.where(thin_line, subpix_f * thin_line_keep, subpix_f)

    # Pick the pixel pair across the edge (N/S for horizontal spans).
    grad_n = np.where(horz_span, l_n, l_w) - l_m
    grad_s = np.where(horz_span, l_s, l_e) - l_m
    pair_n = np.abs(grad_n) >= np.abs(grad_s)
    gradient = np.maximum(np.abs(grad_n), np.abs(grad_s))
    length_sign = np.where(pair_n, -1.0, 1.0)
    l_pair = np.where(horz_span, np.where(pair_n, l_n, l_s),
                      np.where(pair_n, l_w, l_e))
    l_nn = l_pair + l_m
    gradient_scaled = gradient * 0.25
    l_lt_zero = (l_m - l_nn * 0.5) < 0.0

    # posB sits on the edge boundary, half a pixel toward the pair side.
    ys = np.arange(h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
    xs = np.arange(w, dtype=np.float32)[None, :] * np.ones((h, 1), np.float32)
    pos_bx = xs + np.where(horz_span, 0.0, length_sign * 0.5)
    pos_by = ys + np.where(horz_span, length_sign * 0.5, 0.0)

    # Search along the edge for both ends of the span.
    off_x = np.where(horz_span, 1.0, 0.0)
    off_y = np.where(horz_span, 0.0, 1.0)
    pos_nx = pos_bx - off_x
    pos_ny = pos_by - off_y
    pos_px = pos_bx + off_x
    pos_py = pos_by + off_y
    half_nn = l_nn * 0.5
    end_n = _bilinear(luma, pos_nx, pos_ny) - half_nn
    end_p = _bilinear(luma, pos_px, pos_py) - half_nn
    done_n = np.abs(end_n) >= gradient_scaled
    done_p = np.abs(end_p) >= gradient_scaled
    for step in QUALITY_STEPS:
        todo_n = ~done_n
        if todo_n.any():
            pos_nx = np.where(todo_n, pos_nx - off_x * step, pos_nx)
            pos_ny = np.where(todo_n, pos_ny - off_y * step, pos_ny)
            e = _bilinear(luma, pos_nx, pos_ny) - half_nn
            end_n = np.where(todo_n, e, end_n)
            done_n |= np.abs(end_n) >= gradient_scaled
        todo_p = ~done_p
        if todo_p.any():
            pos_px = np.where(todo_p, pos_px + off_x * step, pos_px)
            pos_py = np.where(todo_p, pos_py + off_y * step, pos_py)
            e = _bilinear(luma, pos_px, pos_py) - half_nn
            end_p = np.where(todo_p, e, end_p)
            done_p |= np.abs(end_p) >= gradient_scaled

    # Blend amount from the distance to the nearer edge end.
    dst_n = np.maximum(np.where(horz_span, xs - pos_nx, ys - pos_ny), 0.0)
    dst_p = np.maximum(np.where(horz_span, pos_px - xs, pos_py - ys), 0.0)
    span_len = np.maximum(dst_n + dst_p, 1e-6)
    near_n = dst_n < dst_p
    dst = np.minimum(dst_n, dst_p)
    good_n = (end_n < 0.0) != l_lt_zero
    good_p = (end_p < 0.0) != l_lt_zero
    good_span = np.where(near_n, good_n, good_p)
    pixel_offset = np.clip(0.5 - dst / span_len, 0.0, 1.0)
    pixel_offset = np.where(good_span, pixel_offset, 0.0)
    blend = np.maximum(pixel_offset, subpix_f)
    blend = np.where(early_exit, 0.0, blend)

    # Final fetch shifted across the edge perpendicular.
    out_x = xs + np.where(horz_span, 0.0, blend * length_sign)
    out_y = ys + np.where(horz_span, blend * length_sign, 0.0)
    result = _bilinear(src, out_x, out_y)
    debug = {
        "blend": blend.astype(np.float32),
        "horz_span": horz_span,
        "early_exit": early_exit,
        "thin_line": thin_line,
    }
    return result.astype(np.float32), debug

