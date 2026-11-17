"""Acceptance tests for the DoF post-process.

Covers the acceptance criteria:
  * focused subject stays sharp (near and far focus)
  * defocused subject actually blurs
  * background blur transitions stay continuous
  * bright highlights form bounded bokeh shapes without sampling holes
  * foreground / background use different CoC radius limits
"""

from __future__ import annotations

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dof_post import DofSettings, LensSettings, apply_dof, render_scene
from dof_post.coc import signed_coc, split_fields

H, W = 360, 640
F_NUMBER = 2.0
SAMPLES = 128


def _luminance(img: np.ndarray) -> np.ndarray:
    return img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _gradient_energy(img: np.ndarray, mask: np.ndarray) -> float:
    lum = _luminance(img)
    gy, gx = np.gradient(lum)
    mag = np.hypot(gx, gy)
    return float(mag[mask].mean())


def _disc_mask(cx: float, cy: float, r: float) -> np.ndarray:
    yy, xx = np.mgrid[0:H, 0:W]
    return (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r


def _rect_mask(x0: int, y0: int, x1: int, y1: int) -> np.ndarray:
    mask = np.zeros((H, W), dtype=bool)
    mask[y0:y1, x0:x1] = True
    return mask


class DofAcceptanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.color, cls.depth = render_scene(H, W)
        cls.settings = DofSettings(num_samples=SAMPLES, blades=6)
        cls.near_lens = LensSettings(focus_distance=2.0, f_number=F_NUMBER,
                                     max_coc_near=12.0, max_coc_far=16.0)
        cls.far_lens = LensSettings(focus_distance=8.0, f_number=F_NUMBER,
                                    max_coc_near=12.0, max_coc_far=16.0)
        cls.out_near, cls.coc_near = apply_dof(
            cls.color, cls.depth, cls.near_lens, cls.settings)
        cls.out_far, cls.coc_far = apply_dof(
            cls.color, cls.depth, cls.far_lens, cls.settings)
        # Subject masks (eroded to avoid edge influence).
        cls.disc = _disc_mask(0.30 * W, 0.55 * H, 0.17 * H - 8)
        cls.board = _rect_mask(int(0.60 * W) + 8, int(0.30 * H) + 8,
                               int(0.86 * W) - 8, int(0.62 * H) - 8)

    def test_coc_sign_and_asymmetric_clamp(self) -> None:
        lens = LensSettings(focus_distance=4.0, f_number=1.4,
                            max_coc_near=6.0, max_coc_far=18.0)
        coc = signed_coc(np.array([1.0, 4.0, 40.0], dtype=np.float32), lens)
        self.assertLess(coc[0], 0.0)          # foreground is negative
        self.assertAlmostEqual(float(coc[1]), 0.0, places=5)  # focal plane
        self.assertGreater(coc[2], 0.0)       # background is positive
        near, far = split_fields(coc)
        self.assertLessEqual(float(near.max()), 6.0)
        self.assertLessEqual(float(far.max()), 18.0)
        # Field radii really differ between near and far.
        self.assertNotEqual(float(near.max()), float(far.max()))

    def test_focused_subject_stays_sharp(self) -> None:
        for out, mask, name in ((self.out_near, self.disc, "near disc"),
                                (self.out_far, self.board, "far board")):
            sharp = _gradient_energy(self.color, mask)
            blurred = _gradient_energy(out, mask)
            ratio = blurred / max(sharp, 1e-8)
            self.assertGreaterEqual(
                ratio, 0.90,
                f"{name} lost sharpness in focus: ratio={ratio:.3f}")

    def test_defocused_subject_blurs(self) -> None:
        for out, mask, name in ((self.out_near, self.board, "far board"),
                                (self.out_far, self.disc, "near disc")):
            sharp = _gradient_energy(self.color, mask)
            blurred = _gradient_energy(out, mask)
            ratio = blurred / max(sharp, 1e-8)
            self.assertLessEqual(
                ratio, 0.55,
                f"{name} not blurred enough out of focus: ratio={ratio:.3f}")

    def test_background_transition_continuous(self) -> None:
        # Ground strip on the right, away from occluders: depth ramps
        # smoothly, so the blurred output must not gain new sharp edges.
        strip = np.zeros((H, W), dtype=bool)
        strip[300:340, 350:630] = True
        lum_in = _luminance(self.color)
        lum_out = _luminance(self.out_near)
        gy_in, gx_in = np.gradient(lum_in)
        gy_out, gx_out = np.gradient(lum_out)
        max_in = float(np.hypot(gx_in, gy_in)[strip].max())
        max_out = float(np.hypot(gx_out, gy_out)[strip].max())
        self.assertLessEqual(
            max_out, max_in + 1e-3,
            f"blur introduced a sharper edge ({max_out} > {max_in})")
        # Row-to-row luminance steps stay small: smooth blur transition.
        col = lum_out[290:355, 500]
        self.assertLess(float(np.abs(np.diff(col)).max()), 0.08)

    def test_no_sampling_holes_in_bokeh(self) -> None:
        # Uniform bright HDR plane at far depth: the blurred output must
        # stay uniform (no dark speckles from kernel gaps).
        flat = np.full((H, W, 3), 3.0, dtype=np.float32)
        depth = np.full((H, W), 30.0, dtype=np.float32)
        out, _ = apply_dof(flat, depth, self.near_lens, self.settings)
        inner = out[40:-40, 40:-40]
        mean = float(inner.mean())
        self.assertGreater(float(inner.min()), 0.95 * mean,
                           "sampling holes detected in blurred highlight")

    def test_bokeh_shape_bounded_and_energy_conserved(self) -> None:
        # Single bright point: bokeh must stay inside max CoC + margin and
        # roughly conserve total energy.
        img = np.zeros((H, W, 3), dtype=np.float32)
        img[H // 2, W // 2] = 8.0
        depth = np.full((H, W), 30.0, dtype=np.float32)
        flat_settings = DofSettings(num_samples=SAMPLES, blades=6,
                                    highlight_gain=0.0)
        out, _ = apply_dof(img, depth, self.near_lens, flat_settings)
        ys, xs = np.nonzero(out.sum(axis=-1) > 1e-4)
        radius = max(np.abs(ys - H // 2).max(), np.abs(xs - W // 2).max())
        self.assertLessEqual(radius, self.near_lens.max_coc_far + 2)
        energy_in = float(img.sum())
        energy_out = float(out.sum())
        self.assertAlmostEqual(energy_out / energy_in, 1.0, delta=0.15)
        # With highlight boost enabled the disc gets brighter, but the
        # normalised gather is a weighted average: output can never
        # exceed the brightest input, so the bokeh stays bounded.
        boosted, _ = apply_dof(img, depth, self.near_lens, self.settings)
        self.assertLessEqual(float(boosted.max()), 8.0 + 1e-4)
        self.assertGreater(float(boosted.max()), float(out.max()))

    def test_focus_switch_near_to_far(self) -> None:
        # Sweep focus from the near subject to the far subject: the near
        # disc must lose sharpness while the far board gains it.
        focuses = [2.0, 3.2, 4.4, 5.6, 6.8, 8.0]
        disc_sharp, board_sharp = [], []
        ref_disc = _gradient_energy(self.color, self.disc)
        ref_board = _gradient_energy(self.color, self.board)
        for focus in focuses:
            lens = LensSettings(focus_distance=focus, f_number=F_NUMBER,
                                max_coc_near=12.0, max_coc_far=16.0)
            out, _ = apply_dof(self.color, self.depth, lens, self.settings)
            disc_sharp.append(_gradient_energy(out, self.disc) / ref_disc)
            board_sharp.append(_gradient_energy(out, self.board) / ref_board)
        self.assertGreater(disc_sharp[0], 0.90)
        self.assertLess(disc_sharp[-1], 0.55)
        self.assertLess(board_sharp[0], 0.55)
        self.assertGreater(board_sharp[-1], 0.90)
        self.assertTrue(all(disc_sharp[i] >= disc_sharp[i + 1] - 0.05
                            for i in range(len(focuses) - 1)),
                        f"disc sharpness not monotonic: {disc_sharp}")
        self.assertTrue(all(board_sharp[i] <= board_sharp[i + 1] + 0.05
                            for i in range(len(focuses) - 1)),
                        f"board sharpness not monotonic: {board_sharp}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
