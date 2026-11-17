"""Quantitative validation of the film-grain output."""

from __future__ import annotations

import numpy as np

from .scene import BLACK_BORDER


def luma(img01: np.ndarray) -> np.ndarray:
    w = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return np.tensordot(img01, w, axes=(-1, 0)).astype(np.float32)


def std_report(clean: np.ndarray, grained: np.ndarray) -> dict:
    """Standard deviation before/after grain and of the grain delta itself."""
    lc, lg = luma(clean), luma(grained)
    delta = lg - lc
    return {
        "std_clean": float(np.std(lc)),
        "std_grained": float(np.std(lg)),
        "std_delta": float(np.std(delta)),
        "mean_delta": float(np.mean(delta)),
        "min_delta": float(np.min(delta)),
        "max_delta": float(np.max(delta)),
    }


def regional_std(clean: np.ndarray, grained: np.ndarray) -> dict:
    """Grain amplitude measured separately in dark vs bright regions."""
    lc = luma(clean)
    delta = luma(grained) - lc
    shadow = (lc > 0.0) & (lc < 0.30)
    highlight = lc > 0.75
    return {
        "shadow_std_delta": float(np.std(delta[shadow])) if shadow.any() else 0.0,
        "highlight_std_delta": (
            float(np.std(delta[highlight])) if highlight.any() else 0.0
        ),
    }


def black_lift(clean: np.ndarray, grained: np.ndarray) -> dict:
    """Pure-black border must stay exactly black (no lifted grey floor)."""
    lc = luma(clean)
    lg = luma(grained)
    black = lc <= 0.0
    return {
        "black_pixels": int(black.sum()),
        "black_max_after": float(lg[black].max()),
        "black_mean_after": float(lg[black].mean()),
        "black_lifted_pixels": int(np.count_nonzero(lg[black] > 0.0)),
    }


def temporal_stability(grained_frames: list[np.ndarray],
                       clean_frames: list[np.ndarray]) -> dict:
    """Correlate consecutive grain fields; white noise would give ~0."""
    corrs = []
    for a, b, ca, cb in zip(grained_frames[:-1], grained_frames[1:],
                            clean_frames[:-1], clean_frames[1:]):
        da = luma(a) - luma(ca)
        db = luma(b) - luma(cb)
        sa, sb = np.std(da), np.std(db)
        if sa > 0 and sb > 0:
            corrs.append(float(np.mean(da * db) / (sa * sb)))
    return {
        "temporal_corr_mean": float(np.mean(corrs)) if corrs else 0.0,
        "temporal_corr_min": float(np.min(corrs)) if corrs else 0.0,
    }


def edge_repetition(grained: np.ndarray, clean: np.ndarray,
                    strip: int = BLACK_BORDER) -> dict:
    """Check whether the grain pattern repeats/wraps at opposite edges.

    A tiling noise gives correlation near 1 between opposite-edge grain strips.
    Hash lattice noise gives correlation near 0.  Also checks grain content
    inside the black border is absent.
    """
    delta = luma(grained) - luma(clean)
    top = delta[:strip, strip:-strip]
    bottom = delta[-strip:, strip:-strip]
    left = delta[strip:-strip, :strip]
    right = delta[strip:-strip, -strip:]

    def corr(a, b):
        sa, sb = np.std(a), np.std(b)
        if sa == 0 or sb == 0:
            return 0.0
        return float(np.mean(a * b) / (sa * sb))

    return {
        "edge_corr_top_bottom": corr(top, bottom),
        "edge_corr_left_right": corr(left, right),
        "edge_corr_random_ref": corr(top, np.roll(bottom, 37)),
    }
