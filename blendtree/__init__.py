"""2D animation blend tree (stdlib only).

Blend space axes: move speed m (m/s) and turn speed t (rad/s).
Clips: idle, walk, run, turnL, turnR.  All math is plain Python so the
project runs without numpy/matplotlib.
"""
from .blendspace import BlendSpace, BlendPoint
from .mixer import RobustMixer, NaiveMixer, InputFilter
from .clips import build_clips, CLIP_NAMES
from .skeleton import Skeleton, Pose

__all__ = [
    "BlendSpace", "BlendPoint", "RobustMixer", "NaiveMixer",
    "InputFilter", "build_clips", "CLIP_NAMES", "Skeleton", "Pose",
]
