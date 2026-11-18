import numpy as np

from bloom import (
    BloomConfig,
    apply_bloom,
    box_blur,
    brightness_extract,
    build_pyramid,
    downsample,
    gaussian_blur,
    soft_knee_gain,
    upsample,
)
from bloom.metrics import peak_luminance, whiteness_ratio


def _solid(h=64, w=64, value=2.0):
    return np.full((h, w, 3), value, dtype=np.float32)


def test_soft_knee_endpoints():
    luma = np.array([[[0.2]], [[1.0]], [[1.3]], [[1.6]], [[2.0]]], dtype=np.float32)
    gain = soft_knee_gain(luma, threshold=1.0, soft_knee=0.6)[..., 0]
    assert gain[0] == 0.0 and gain[1] == 0.0
    assert 0.0 < gain[2] < 1.0
    assert gain[3] > gain[2]
    assert gain[4] == 1.0


def test_hard_threshold_when_soft_knee_zero():
    luma = np.array([[[0.9]], [[1.0]], [[1.1]]], dtype=np.float32)
    gain = soft_knee_gain(luma, threshold=1.0, soft_knee=0.0)[:, 0, 0]
    assert gain.tolist() == [0.0, 0.0, 1.0]


def test_brightness_extract_masks_dim_pixels():
    image = np.zeros((8, 8, 3), dtype=np.float32)
    image[2:5, 2:5] = 3.0
    extracted = brightness_extract(image, threshold=1.0, soft_knee=0.0)
    assert extracted[:2, :, :].max() == 0.0
    assert extracted[3, 3, 0] == 3.0


def test_downsample_halves_resolution_and_preserves_energy():
    image = _solid(32, 32, 1.0)
    small = downsample(image, blur_radius=1)
    assert small.shape == (16, 16, 3)
    assert np.allclose(small, 1.0, atol=1e-6)


def test_pyramid_levels_shrink_progressively():
    config = BloomConfig(levels=4)
    pyramid = build_pyramid(_solid(128, 128), config)
    assert len(pyramid) == 5
    for finer, coarser in zip(pyramid, pyramid[1:]):
        assert coarser.shape[0] == finer.shape[0] // 2


def test_weights_normalized():
    config = BloomConfig(level_weights=(2.0, 1.0, 1.0), levels=3)
    weights = config.normalized_weights()
    assert np.isclose(weights.sum(), 1.0)
    assert np.isclose(weights[0], 0.5)


def test_upsample_matches_target_shape():
    image = _solid(16, 16, 0.5)
    grown = upsample(image, (32, 32), sigma=1.0)
    assert grown.shape == (32, 32, 3)


def test_blurs_smooth_and_keep_shape():
    image = np.zeros((24, 24, 3), dtype=np.float32)
    image[12, 12] = 4.0
    for blurred in (box_blur(image, 2), gaussian_blur(image, 2.0)):
        assert blurred.shape == image.shape
        assert blurred[12, 12, 0] < 4.0
        assert blurred[10, 12, 0] > 0.0


def test_bloom_is_local_and_does_not_whiten_frame():
    image = np.full((96, 96, 3), 0.05, dtype=np.float32)
    image[44:52, 44:52] = 8.0
    config = BloomConfig(threshold=1.0, soft_knee=0.5, levels=4)
    result = apply_bloom(image, config)
    composite = result["composite"]
    assert composite.shape == image.shape
    assert peak_luminance(composite) >= peak_luminance(image)
    # Corner far from the emitter must stay essentially unchanged.
    assert abs(float(composite[0, 0, 0]) - 0.05) < 0.02
    # No more than a small fraction of pixels may approach clipped white.
    assert whiteness_ratio(composite) < 0.05


def test_zero_bloom_when_everything_below_threshold():
    image = _solid(48, 48, 0.4)
    config = BloomConfig(threshold=1.0, soft_knee=0.1)
    result = apply_bloom(image, config)
    assert float(result["bloom"].max()) == 0.0
    assert np.allclose(result["composite"], image)
