"""Shader feature sets and static variant specifications.

A *shader feature* is a compile-time ``#define`` (keyword ``_ALPHATEST``,
``_BLEND`` ...).  Variants share a compiled program when their feature set is
identical, so each feature is enabled only for the variants that need it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Variant(str, Enum):
    """The five variants produced from one base material."""

    OPAQUE = "opaque"
    MASKED = "masked"
    TRANSPARENT = "transparent"
    DOUBLE_SIDED = "double_sided"
    SHADOW = "shadow"


class ShaderFeature(str, Enum):
    """Compile-time shader keywords."""

    ALBEDO_MAP = "_ALBEDO_MAP"
    NORMAL_MAP = "_NORMAL_MAP"
    METALLIC_ROUGHNESS_MAP = "_METALLICROUGHNESS_MAP"
    EMISSIVE_MAP = "_EMISSIVE_MAP"
    ALPHA_TEST = "_ALPHATEST"
    ALPHA_BLEND = "_ALPHABLEND"
    DOUBLE_SIDED = "_DOUBLESIDED"
    SHADOW_PASS = "_SHADOW_PASS"


class TextureSlot(str, Enum):
    """Named texture binding slots."""

    ALBEDO = "albedo"
    NORMAL = "normal"
    METALLIC_ROUGHNESS = "metallic_roughness"
    EMISSIVE = "emissive"


@dataclass(frozen=True)
class VariantSpec:
    """Static description of a variant kind."""

    variant: Variant
    features: frozenset[ShaderFeature]
    texture_slots: frozenset[TextureSlot]
    render_queue: int
    cull_back: bool
    depth_write: bool
    blend: bool
    extra_uniforms: frozenset[str] = field(default_factory=frozenset)


_F = ShaderFeature
_T = TextureSlot

# All textured-lighting variants share the same material maps; only the
# surface/state keywords differ between them.
_LIGHTING_MAPS = frozenset(
    {_T.ALBEDO, _T.NORMAL, _T.METALLIC_ROUGHNESS, _T.EMISSIVE}
)
_MAP_FEATURES = frozenset(
    {
        _F.ALBEDO_MAP,
        _F.NORMAL_MAP,
        _F.METALLIC_ROUGHNESS_MAP,
        _F.EMISSIVE_MAP,
    }
)

VARIANT_SPECS: dict[Variant, VariantSpec] = {
    Variant.OPAQUE: VariantSpec(
        variant=Variant.OPAQUE,
        features=_MAP_FEATURES,
        texture_slots=_LIGHTING_MAPS,
        render_queue=2000,
        cull_back=True,
        depth_write=True,
        blend=False,
    ),
    Variant.MASKED: VariantSpec(
        variant=Variant.MASKED,
        features=_MAP_FEATURES | {_F.ALPHA_TEST},
        texture_slots=_LIGHTING_MAPS,
        render_queue=2010,
        cull_back=True,
        depth_write=True,
        blend=False,
        extra_uniforms=frozenset({"alpha_cutoff"}),
    ),
    Variant.TRANSPARENT: VariantSpec(
        variant=Variant.TRANSPARENT,
        features=_MAP_FEATURES | {_F.ALPHA_BLEND},
        texture_slots=_LIGHTING_MAPS,
        render_queue=3000,
        cull_back=True,
        depth_write=False,
        blend=True,
        extra_uniforms=frozenset({"opacity"}),
    ),
    Variant.DOUBLE_SIDED: VariantSpec(
        variant=Variant.DOUBLE_SIDED,
        features=_MAP_FEATURES | {_F.DOUBLE_SIDED},
        texture_slots=_LIGHTING_MAPS,
        render_queue=2000,
        cull_back=False,
        depth_write=True,
        blend=False,
    ),
    # Depth-only shadow caster: no lighting maps, no blend, minimal program.
    Variant.SHADOW: VariantSpec(
        variant=Variant.SHADOW,
        features=frozenset({_F.SHADOW_PASS}),
        texture_slots=frozenset(),
        render_queue=1900,
        cull_back=True,
        depth_write=True,
        blend=False,
    ),
}

#: Convenience mapping ``Variant -> frozenset[ShaderFeature]``.
VARIANT_FEATURES: dict[Variant, frozenset[ShaderFeature]] = {
    variant: spec.features for variant, spec in VARIANT_SPECS.items()
}

#: Uniforms every lighting variant uploads; shadow variants upload none of them.
COMMON_UNIFORMS: frozenset[str] = frozenset(
    {"base_color", "metallic", "roughness", "emissive_color", "uv_transform"}
)

#: Render queue buckets, front-to-back for opaque, back-to-front for blended.
QUEUE_OPAQUE_MAX = 2999
