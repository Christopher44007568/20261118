"""Reproducible blue-noise dithering toolkit.

Pipeline contract: dithered color quantization happens on the
semi-transparent layer *before* alpha blending, and the noise is
sampled in screen space (pixel coords mod texture size, no time
term) so the pattern is locked to the screen when the camera moves.
"""

from .bluenoise import blue_noise_texture, white_noise_texture, bayer_matrix
from .dither import DitherMode, quantize

__all__ = [
    "blue_noise_texture",
    "white_noise_texture",
    "bayer_matrix",
    "DitherMode",
    "quantize",
]
