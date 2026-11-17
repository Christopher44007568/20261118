"""Active variant counts and VRAM estimation."""

import unittest

from matvariants import MaterialManager, Variant
from matvariants.gpu import SHADER_PROGRAM_BYTES, UNIFORM_BLOCK_BYTES
from tests.test_variants import make_textured_manager


def human_size(num_bytes: int) -> str:
    units = ["B", "KB", "MB", "GB"]
    size = float(num_bytes)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.2f} {unit}"
        size /= 1024
    return f"{num_bytes} B"


class StatsTests(unittest.TestCase):
    def test_active_count_grows_lazily(self) -> None:
        _, manager, material = make_textured_manager()
        self.assertEqual(material.active_variant_count, 0)
        material.get_variant(Variant.OPAQUE).ensure_resident()
        self.assertEqual(material.active_variant_count, 1)
        material.get_variant(Variant.SHADOW).ensure_resident()
        self.assertEqual(material.active_variant_count, 2)
        self.assertEqual(manager.total_active_variants, 2)

    def test_vram_estimate_breakdown(self) -> None:
        _, manager, material = make_textured_manager()
        manager.warm_all_variants(material)
        estimate = material.vram_estimate()
        # Four 64x64 RGBA8 textures, each aligned to 4096 -> 16384.
        self.assertEqual(estimate["textures"], 4 * 16384)
        self.assertEqual(estimate["programs"], 5 * SHADER_PROGRAM_BYTES)
        self.assertEqual(estimate["uniforms"], 5 * UNIFORM_BLOCK_BYTES)
        self.assertEqual(
            estimate["total"],
            estimate["textures"]
            + estimate["programs"]
            + estimate["uniforms"],
        )

    def test_stats_snapshot_shape(self) -> None:
        _, manager, material = make_textured_manager()
        manager.warm_all_variants(material)
        stats = manager.stats()
        self.assertEqual(stats["materials"], 1)
        self.assertEqual(stats["cached_variants"], 5)
        self.assertEqual(stats["active_variants"], 5)
        self.assertEqual(stats["textures_resident"], 4)
        self.assertEqual(stats["programs_resident"], 5)
        self.assertEqual(stats["uniform_blocks"], 5)
        self.assertEqual(
            stats["vram"]["device_bytes"],
            stats["vram"]["attributed_bytes"],
        )

    def test_shared_program_savings_reported(self) -> None:
        device, manager, _ = make_textured_manager()
        second = manager.create_material("brick")
        from matvariants import TextureSlot

        for slot in TextureSlot:
            second.set_texture(slot, f"brick_{slot.value}", 64, 64)
        for material in manager:
            manager.warm_all_variants(material)
        stats = manager.stats()
        # Five identical feature sets across two materials -> shared programs.
        self.assertGreater(stats["vram"]["shared_program_savings"], 0)
        self.assertEqual(stats["programs_resident"], 5)

    def test_human_size_helper(self) -> None:
        self.assertEqual(human_size(0), "0.00 B")
        self.assertEqual(human_size(1024), "1.00 KB")
        self.assertEqual(human_size(1024 * 1024), "1.00 MB")


if __name__ == "__main__":
    unittest.main()
