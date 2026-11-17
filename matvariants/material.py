"""Base material and its lazily-built GPU variants."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from .features import (
    COMMON_UNIFORMS,
    VARIANT_SPECS,
    TextureSlot,
    Variant,
    VariantSpec,
)
from .gpu import UNIFORM_BLOCK_BYTES, GPUDevice, RenderContext, ShaderProgram, Texture

if TYPE_CHECKING:
    from .features import ShaderFeature


DEFAULT_PARAMS: dict[str, Any] = {
    "base_color": (1.0, 1.0, 1.0, 1.0),
    "metallic": 0.0,
    "roughness": 0.8,
    "emissive_color": (0.0, 0.0, 0.0),
    "uv_transform": (1.0, 1.0, 0.0, 0.0, 0.0, 0.0),
    "alpha_cutoff": 0.5,
    "opacity": 1.0,
}


class MaterialError(RuntimeError):
    """Base class for material system errors."""


class MissingTextureError(MaterialError):
    """Raised when a variant needs a texture slot the material never filled."""


class MaterialDestroyedError(MaterialError):
    """Raised when a destroyed material is used."""


class BaseMaterial:
    """A material template that compiles into five :class:`MaterialVariant`."""

    def __init__(self, device: GPUDevice, name: str) -> None:
        self._device = device
        self.name = name
        self._params: dict[str, Any] = dict(DEFAULT_PARAMS)
        self._textures: dict[TextureSlot, Texture | None] = {
            slot: None for slot in TextureSlot
        }
        self._variants: dict[Variant, MaterialVariant] = {}
        self._version = 0
        self._destroyed = False

    # -- parameters ---------------------------------------------------------
    def get_param(self, name: str) -> Any:
        self._check_alive()
        return self._params[name]

    def set_param(self, name: str, value: Any) -> None:
        """Change a base parameter and invalidate every cached variant."""
        self._check_alive()
        if name not in DEFAULT_PARAMS:
            raise KeyError(f"unknown material parameter: {name!r}")
        if self._params[name] == value:
            return
        self._params[name] = value
        self.invalidate(f"param:{name}")

    @property
    def params(self) -> dict[str, Any]:
        return dict(self._params)

    # -- textures -----------------------------------------------------------
    def set_texture(
        self, slot: TextureSlot, name: str, width: int = 256, height: int = 256
    ) -> Texture:
        self._check_alive()
        old = self._textures[slot]
        if old is not None:
            self._device.release_texture(old.name)
        texture = self._device.create_texture(name, width, height)
        self._textures[slot] = texture
        self.invalidate(f"texture:{slot.value}")
        return texture

    def clear_texture(self, slot: TextureSlot) -> None:
        self._check_alive()
        old = self._textures[slot]
        if old is not None:
            self._device.release_texture(old.name)
            self._textures[slot] = None
            self.invalidate(f"texture:{slot.value}")

    def get_texture(self, slot: TextureSlot) -> Texture | None:
        return self._textures[slot]

    @property
    def texture_names(self) -> dict[TextureSlot, str | None]:
        return {
            slot: None if texture is None else texture.name
            for slot, texture in self._textures.items()
        }

    # -- variants -----------------------------------------------------------
    def get_variant(self, kind: Variant) -> "MaterialVariant":
        self._check_alive()
        variant = self._variants.get(kind)
        if variant is None:
            variant = MaterialVariant(self, VARIANT_SPECS[kind])
            self._variants[kind] = variant
        return variant

    def invalidate(self, reason: str = "") -> int:
        """Bump the material version and evict all resident variant GPU state."""
        self._version += 1
        for variant in self._variants.values():
            variant.release()
        return self._version

    @property
    def version(self) -> int:
        return self._version

    @property
    def is_destroyed(self) -> bool:
        return self._destroyed

    @property
    def resident_variants(self) -> tuple["MaterialVariant", ...]:
        return tuple(
            variant for variant in self._variants.values() if variant.is_resident
        )

    @property
    def active_variant_count(self) -> int:
        """Number of variants currently holding GPU resources."""
        return len(self.resident_variants)

    @property
    def cached_variant_count(self) -> int:
        """Number of variant objects created so far (resident or stale)."""
        return len(self._variants)

    def vram_estimate(self) -> dict[str, int]:
        """Estimate VRAM attributable to this material.

        Textures are owned by the base material; programs and uniform blocks
        by its resident variants.  Shared programs are counted per variant
        here, while :attr:`GPUDevice.used_vram_bytes` remains the authoritative
        global figure with sharing deduplicated.
        """
        texture_bytes = sum(
            texture.size_bytes
            for texture in self._textures.values()
            if texture is not None
        )
        program_bytes = sum(
            variant.program.size_bytes
            for variant in self.resident_variants
        )
        uniform_bytes = UNIFORM_BLOCK_BYTES * self.active_variant_count
        return {
            "textures": texture_bytes,
            "programs": program_bytes,
            "uniforms": uniform_bytes,
            "total": texture_bytes + program_bytes + uniform_bytes,
        }

    # -- lifecycle ----------------------------------------------------------
    def destroy(self) -> None:
        """Release every variant and every texture owned by this material."""
        if self._destroyed:
            return
        for variant in self._variants.values():
            variant.release()
        self._variants.clear()
        for texture in self._textures.values():
            if texture is not None:
                self._device.release_texture(texture.name)
        self._textures = {slot: None for slot in TextureSlot}
        self._destroyed = True

    def _check_alive(self) -> None:
        if self._destroyed:
            raise MaterialDestroyedError(f"material {self.name!r} is destroyed")

    def __repr__(self) -> str:
        return (
            f"BaseMaterial(name={self.name!r}, version={self._version}, "
            f"active_variants={self.active_variant_count})"
        )


@dataclass
class MaterialVariant:
    """One compiled surface of a :class:`BaseMaterial`.

    GPU resources are acquired lazily through :meth:`ensure_resident` and
    released on material invalidation or destruction.  The variant pins the
    material version it was built for, so a stale variant is rebuilt before it
    is applied even if its program object could be shared.
    """

    material: BaseMaterial
    spec: VariantSpec
    program: ShaderProgram | None = None
    _resident: bool = False
    _built_version: int = -1

    @property
    def kind(self) -> Variant:
        return self.spec.variant

    @property
    def features(self) -> frozenset["ShaderFeature"]:
        return self.spec.features

    @property
    def is_resident(self) -> bool:
        return self._resident and self.program is not None

    @property
    def built_version(self) -> int:
        return self._built_version

    @property
    def buffer_key(self) -> tuple[str, str]:
        return (self.material.name, self.kind.value)

    def ensure_resident(self) -> None:
        """Compile the program and allocate the uniform block if needed."""
        self.material._check_alive()
        if self.is_resident and self._built_version == self.material.version:
            return
        if self.is_resident:
            self.release()
        self.program = self.material._device.create_program(self.spec.features)
        self.material._device.acquire_buffer(
            self.buffer_key, UNIFORM_BLOCK_BYTES
        )
        self._resident = True
        self._built_version = self.material.version

    def release(self) -> None:
        """Drop the program reference and free the uniform block."""
        if not self._resident:
            return
        device = self.material._device
        if self.program is not None:
            device.release_program(self.spec.features)
        device.release_buffer(self.buffer_key)
        self.program = None
        self._resident = False

    # -- binding ------------------------------------------------------------
    def uniform_block(self) -> dict[str, Any]:
        """Build the uniform values for this variant from the base material."""
        params = self.material.params
        if self.kind is Variant.SHADOW:
            return {}
        block = {name: params[name] for name in COMMON_UNIFORMS}
        for extra in self.spec.extra_uniforms:
            block[extra] = params[extra]
        return block

    def apply(self, context: RenderContext) -> None:
        """Synchronize program, texture slots and uniforms with the context."""
        self.ensure_resident()
        assert self.program is not None
        context.bind_program(self.program)

        for slot in self.spec.texture_slots:
            texture = self.material.get_texture(slot)
            if texture is None:
                raise MissingTextureError(
                    f"variant {self.kind.value!r} of material "
                    f"{self.material.name!r} requires slot {slot.value!r}"
                )
            context.bind_texture(slot, texture.name)

        for name, value in self.uniform_block().items():
            context.set_uniform(name, value)

    def __repr__(self) -> str:
        state = "resident" if self.is_resident else "stale"
        return (
            f"MaterialVariant({self.material.name!r}:{self.kind.value} "
            f"{state}, v{self._built_version})"
        )
