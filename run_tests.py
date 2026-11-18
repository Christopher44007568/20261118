#!/usr/bin/env python3
"""Self-contained test runner (no pytest needed): python3 run_tests.py"""

import numpy as np

from noise_dither.analysis import (low_frequency_energy_ratio,
                                   repeat_block_score)
from noise_dither.bluenoise import (bayer_matrix, blue_noise_texture,
                                    white_noise_texture)
from noise_dither.dither import DitherMode, dither_field, quantize
from noise_dither.scenes import scene_fog, scene_gradient


def test_reproducibility():
    a = blue_noise_texture(64, seed=7)
    b = blue_noise_texture(64, seed=7)
    c = blue_noise_texture(64, seed=8)
    assert np.array_equal(a, b), "same seed must give identical texture"
    assert not np.array_equal(a, c), "different seed must change texture"
    w1 = white_noise_texture(64, seed=7)
    w2 = white_noise_texture(64, seed=7)
    assert np.array_equal(w1, w2)


def test_blue_noise_spectrum():
    blue = blue_noise_texture(128, seed=1337)
    white = white_noise_texture(128, seed=1337)
    lb = low_frequency_energy_ratio(blue)
    lw = low_frequency_energy_ratio(white)
    assert lb < 0.01, f"blue noise has too much low frequency: {lb}"
    assert lw > 20 * lb, "blue noise must suppress low freq vs white"


def test_tileability():
    tex = blue_noise_texture(128, seed=3)
    tiled = np.tile(tex, (2, 2))
    assert low_frequency_energy_ratio(tiled) < 0.01, "tiling introduced seams"


def test_screen_space_stability():
    f1 = dither_field(DitherMode.BLUE, 100, 200, 128, 1337)
    f2 = dither_field(DitherMode.BLUE, 100, 200, 128, 1337)
    assert np.array_equal(f1, f2), "field must not depend on call time/frame"
    tex = blue_noise_texture(128, seed=1337)
    assert np.allclose(f1, tex[np.arange(100) % 128][:, np.arange(200) % 128]), \
        "field must be pure screen-space tiling of the texture"


def test_quantization_grid_and_error_bound():
    scene = scene_gradient(160, 90)
    levels = 10
    for mode in DitherMode:
        q = quantize(scene, levels, mode, seed=5)
        steps = levels - 1
        assert np.allclose(q * steps, np.round(q * steps)), \
            f"{mode}: output not on the quantization grid"
        assert np.abs(q - scene).max() <= 1.0 / steps + 1e-12, \
            f"{mode}: error exceeds one quantization step"


def test_no_checkerboard():
    blue = blue_noise_texture(128, seed=11)
    bayer = bayer_matrix(3)
    assert repeat_block_score(blue) < 0.5
    assert repeat_block_score(bayer) > 0.6, "control: bayer must look periodic"


def test_fog_pipeline_order():
    before = scene_fog(160, 90, mode=DitherMode.BLUE,
                       quantize_before_blend=True, seed=5)
    after = scene_fog(160, 90, mode=DitherMode.BLUE,
                      quantize_before_blend=False, seed=5)
    assert not np.allclose(before, after), \
        "quantize-before-blend and quantize-after-blend must differ"
    ref = scene_fog(160, 90, mode=DitherMode.BLUE,
                    quantize_before_blend=True, seed=5)
    assert np.array_equal(before, ref), "fog render must be deterministic"


def test_camera_moves_noise_does_not():
    fa = scene_fog(160, 90, dx=0.0, mode=DitherMode.BLUE, seed=5)
    fb = scene_fog(160, 90, dx=13.0, mode=DitherMode.BLUE, seed=5)
    assert not np.allclose(fa, fb), "camera move must change the image"
    da = dither_field(DitherMode.BLUE, 90, 160, 128, 5)
    db = dither_field(DitherMode.BLUE, 90, 160, 128, 5)
    assert np.array_equal(da, db)


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"{len(tests)} tests passed")
