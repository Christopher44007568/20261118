"""Quantitative evaluation against ground-truth normals."""
import numpy as np
from scipy.ndimage import gaussian_filter, sobel


def angular_error(n_est, n_gt):
    """Per-pixel angle in degrees between estimated and true normals."""
    cos = np.clip(np.sum(n_est * n_gt, axis=-1), -1.0, 1.0)
    return np.degrees(np.arccos(cos))


def rmse_normal(n_est, n_gt):
    return float(np.sqrt(np.mean((n_est - n_gt) ** 2)))


def edge_map(h, thresh=0.08):
    """Boolean mask of genuine macro edges, from the clean height field."""
    g = np.hypot(sobel(h, axis=0), sobel(h, axis=1))
    return g > thresh * g.max()


def edge_artifact_score(n_est, n_gt, edges, dilate=2):
    """Excess slope energy near true edges: bevel/halo strength.

    Compares gradient magnitude of the reconstructed height against GT inside
    a band around genuine edges. A high score means the method rounds off or
    invents extra slopes (ringing / fake sharp bevels).
    """
    from scipy.ndimage import binary_dilation
    band = binary_dilation(edges, iterations=dilate) & ~edges
    if band.sum() == 0:
        return 0.0
    g_est = np.hypot(sobel(n_est[..., 0]), sobel(n_est[..., 1]))
    g_gt = np.hypot(sobel(n_gt[..., 0]), sobel(n_gt[..., 1]))
    return float(np.abs(g_est - g_gt)[band].mean())


def rough_region_noise(n_est, roughness, quantile=0.7):
    """High-frequency normal energy inside rough (non-edge) regions.

    This measures spurious sharp slopes created by treating capture noise as
    geometry. We high-pass the normal x/y channels and report their RMS.
    """
    mask = roughness >= np.quantile(roughness, quantile)
    hp = n_est[..., :2] - gaussian_filter(n_est[..., :2], (1.2, 1.2, 0))
    return float(np.sqrt((hp[mask] ** 2).mean()))


def evaluate(n_est, n_gt, clean_h, roughness):
    err = angular_error(n_est, n_gt)
    edges = edge_map(clean_h)
    flat = ~edges
    return {
        "mae_deg": float(err.mean()),
        "median_deg": float(np.median(err)),
        "p95_deg": float(np.quantile(err, 0.95)),
        "rmse": rmse_normal(n_est, n_gt),
        "mae_flat_deg": float(err[flat].mean()),
        "mae_edge_deg": float(err[edges].mean()),
        "edge_artifact": edge_artifact_score(n_est, n_gt, edges),
        "rough_noise": rough_region_noise(n_est, roughness),
    }
