"""Deletion must leave no cached GPU state; rebuild must start clean."""

import unittest

from matvariants import (
    GPUDevice,
    MaterialManager,
    RenderContext,
    TextureSlot,
    Variant,
)
from matvariants.material import MaterialDestroyedError
from tests.test_variants import make_textured_manager


class LifecycleTests(unittest.TestCase):
    def test_destroyed_material_leaves_device_empty(self) -> None:
        device, manager, material = make_textured_manager()
        manager.warm_all_variants(material)
        self.assertFalse(device.is_empty)
        manager.delete_material("rock")
        self.assertTrue(device.is_empty)
        self.assertFalse(manager.has_material("rock"))
        self.assertEqual(device.used_vram_bytes, 0)

    def test_destroyed_material_rejects_use(self) -> None:
        device, manager, material = make_textured_manager()
        manager.delete_material("rock")
        with self.assertRaises(MaterialDestroyedError):
            material.set_param("roughness", 0.5)
        with self.assertRaises(MaterialDestroyedError):
            material.get_variant(Variant.OPAQUE)

    def test_recreate_same_name_starts_without_cache(self) -> None:
        device, manager, material = make_textured_manager()
        manager.warm_all_variants(material)
        manager.delete_material("rock")

        rebuilt = manager.recreate_material("rock")
        self.assertEqual(rebuilt.cached_variant_count, 0)
        self.assertEqual(rebuilt.active_variant_count, 0)
        self.assertEqual(rebuilt.version, 0)
        # Recreated material is independent: assign fresh textures and warm.
        for slot in TextureSlot:
            rebuilt.set_texture(slot, f"new_{slot.value}", 32, 32)
        manager.warm_all_variants(rebuilt)
        self.assertEqual(rebuilt.active_variant_count, 5)
        manager.delete_material("rock")
        self.assertTrue(device.is_empty)

    def test_two_materials_delete_independently(self) -> None:
        device = GPUDevice()
        manager = MaterialManager(device)
        first = manager.create_material("first")
        second = manager.create_material("second")
        for material in (first, second):
            for slot in TextureSlot:
                material.set_texture(slot, f"{material.name}_{slot.value}", 16, 16)
            manager.warm_all_variants(material)

        manager.delete_material("first")
        self.assertEqual(manager.material_names, ("second",))
        self.assertEqual(second.active_variant_count, 5)
        # Second material's textures must survive the first deletion.
        self.assertEqual(len(device.resident_texture_names), 4)
        manager.shutdown()
        self.assertTrue(device.is_empty)

    def test_texture_swap_releases_old_allocation(self) -> None:
        device, manager, material = make_textured_manager()
        material.set_texture(TextureSlot.ALBEDO, "replaced", 64, 64)
        self.assertNotIn("albedo_tex", device.resident_texture_names)
        self.assertIn("replaced", device.resident_texture_names)

    def test_shutdown_is_idempotent_and_verifies_clean(self) -> None:
        device, manager, _ = make_textured_manager()
        manager.shutdown()
        self.assertEqual(len(manager), 0)
        self.assertTrue(device.is_empty)
        manager.shutdown()  # no materials -> still clean


if __name__ == "__main__":
    unittest.main()
