"""Material variant management system.

One :class:`~matvariants.material.BaseMaterial` produces five GPU variants
(opaque / masked / transparent / double-sided / shadow).  Each variant enables
only the shader features it needs, texture bindings and uniforms are
synchronized on every apply, base parameter changes invalidate every cached
variant, and deleting a material releases all of its GPU resources.
"""

from .features import (
    COMMON_UNIFORMS,
    VARIANT_FEATURES,
    VARIANT_SPECS,
    ShaderFeature,
    TextureSlot,
    Variant,
    VariantSpec,
)
from .gpu import GPUDevice, RenderContext, ShaderProgram, Texture
from .manager import MaterialManager
from .material import BaseMaterial, MaterialVariant
from .renderer import DrawItem, FrameRenderer

__all__ = [
    "VARIANT_FEATURES",
    "VARIANT_SPECS",
    "Variant",
    "VariantSpec",
    "ShaderFeature",
    "TextureSlot",
    "COMMON_UNIFORMS",
    "GPUDevice",
    "RenderContext",
    "ShaderProgram",
    "Texture",
    "MaterialManager",
    "BaseMaterial",
    "MaterialVariant",
    "DrawItem",
    "FrameRenderer",
]
