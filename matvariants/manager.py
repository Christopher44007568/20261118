"""Owns base materials and reports system-wide variant/VRAM statistics."""

from __future__ import annotations

from .features import Variant
from .gpu import GPUDevice, UNIFORM_BLOCK_BYTES
from .material import BaseMaterial, MaterialDestroyedError


class MaterialManager:
    """Registry of base materials backed by one :class:`GPUDevice`."""

    def __init__(self, device: GPUDevice | None = None) -> None:
        self.device = device or GPUDevice()
        self._materials: dict[str, BaseMaterial] = {}

    def create_material(self, name: str) -> BaseMaterial:
        if name in self._materials:
            raise ValueError(f"material {name!r} already exists")
        material = BaseMaterial(self.device, name)
        self._materials[name] = material
        return material

    def get_material(self, name: str) -> BaseMaterial:
        return self._materials[name]

    def has_material(self, name: str) -> bool:
        return name in self._materials

    def delete_material(self, name: str) -> None:
        """Destroy a material and verify no cached GPU state remains."""
        material = self._materials.pop(name)
        material.destroy()
        if material.cached_variant_count != 0:
            raise RuntimeError(
                f"variant cache for {name!r} not cleared after destruction"
            )

    def recreate_material(self, name: str) -> BaseMaterial:
        """Delete then create a material with the same name (no stale cache)."""
        if name in self._materials:
            self.delete_material(name)
        return self.create_material(name)

    @property
    def material_names(self) -> tuple[str, ...]:
        return tuple(sorted(self._materials))

    @property
    def total_active_variants(self) -> int:
        return sum(material.active_variant_count for material in self)

    def __iter__(self):
        return iter(self._materials.values())

    def __len__(self) -> int:
        return len(self._materials)

    def vram_estimate(self) -> dict[str, object]:
        """Per-material attribution plus the authoritative device total."""
        per_material = {
            material.name: material.vram_estimate() for material in self
        }
        attributed = sum(
            breakdown["total"] for breakdown in per_material.values()
        )
        return {
            "per_material": per_material,
            "attributed_bytes": attributed,
            "device_bytes": self.device.used_vram_bytes,
            "shared_program_savings": attributed - self.device.used_vram_bytes,
            "uniform_blocks_resident": self.total_active_variants,
        }

    def stats(self) -> dict[str, object]:
        """Snapshot used for CLI/demo output."""
        return {
            "materials": len(self),
            "cached_variants": sum(
                material.cached_variant_count for material in self
            ),
            "active_variants": self.total_active_variants,
            "textures_resident": len(self.device.resident_texture_names),
            "programs_resident": len(self.device.resident_program_keys),
            "uniform_blocks": self.total_active_variants,
            "uniform_block_bytes": self.total_active_variants
            * UNIFORM_BLOCK_BYTES,
            "vram": self.vram_estimate(),
        }

    def shutdown(self) -> None:
        """Destroy every material; the device must be empty afterwards."""
        for name in list(self._materials):
            self.delete_material(name)
        if not self.device.is_empty:
            raise RuntimeError("GPU device still holds resources after shutdown")

    def warm_all_variants(self, material: BaseMaterial) -> None:
        for kind in Variant:
            material.get_variant(kind).ensure_resident()

    def assert_no_dangling_references(self) -> None:
        """Every resident program must belong to a live resident variant."""
        live_program_keys = {
            variant.features
            for material in self
            for variant in material.resident_variants
        }
        for key in live_program_keys:
            if self.device.program_refcount(key) <= 0:
                raise RuntimeError(f"dangling program: {key}")

    # Re-exported for convenience in demos/tests.
    MaterialDestroyedError = MaterialDestroyedError
