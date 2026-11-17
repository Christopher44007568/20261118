"""GPU resource accounting: refcounts, sharing, VRAM and budget enforcement."""

import unittest

from matvariants import (
    GPUDevice,
    MaterialManager,
    TextureSlot,
    Variant,
)
from matvariants.gpu import (
    SHADER_PROGRAM_BYTES,
    TEXEL_SIZE,
    TEXTURE_ALIGNMENT,
    UNIFORM_BLOCK_BYTES,
)


class GpuAccountingTests(unittest.TestCase):
    def test_texture_size_is_aligned(self) -> None:
        device = GPUDevice()
        texture = device.create_texture("a", 10, 10)
        expected = ((10 * 10 * TEXEL_SIZE + TEXTURE_ALIGNMENT - 1)
                    // TEXTURE_ALIGNMENT * TEXTURE_ALIGNMENT)
        self.assertEqual(texture.size_bytes, expected)

    def test_texture_refcount_shared_then_released(self) -> None:
        device = GPUDevice()
        first = device.create_texture("shared", 32, 32)
        second = device.create_texture("shared", 32, 32)
        self.assertIs(first, second)
        self.assertEqual(device.texture_refcount("shared"), 2)
        device.release_texture("shared")
        self.assertEqual(device.texture_refcount("shared"), 1)
        device.release_texture("shared")
        self.assertEqual(device.texture_refcount("shared"), 0)
        self.assertNotIn("shared", device.resident_texture_names)

    def test_program_sharing_between_identical_variants(self) -> None:
        device = GPUDevice()
        manager = MaterialManager(device)
        mat_a = manager.create_material("a")
        mat_b = manager.create_material("b")
        for material in (mat_a, mat_b):
            for slot in TextureSlot:
                material.set_texture(slot, f"{material.name}_{slot.value}", 16, 16)
        features = mat_a.get_variant(Variant.OPAQUE).features
        mat_a.get_variant(Variant.OPAQUE).ensure_resident()
        mat_b.get_variant(Variant.OPAQUE).ensure_resident()
        self.assertEqual(device.program_refcount(features), 2)
        # Only one program allocation despite two materials.
        texture_bytes = sum(
            device._textures[name][0].size_bytes
            for name in device.resident_texture_names
        )
        self.assertEqual(
            device.used_vram_bytes
            - texture_bytes
            - 2 * UNIFORM_BLOCK_BYTES,
            SHADER_PROGRAM_BYTES,
        )
        manager.shutdown()
        self.assertTrue(device.is_empty)

    def test_budget_enforced(self) -> None:
        device = GPUDevice(vram_budget_bytes=1024)
        with self.assertRaises(MemoryError):
            device.create_texture("too_big", 64, 64)
        self.assertTrue(device.is_empty)

    def test_buffer_refcounts(self) -> None:
        device = GPUDevice()
        device.acquire_buffer(("m", "opaque"), UNIFORM_BLOCK_BYTES)
        self.assertEqual(device.used_vram_bytes, UNIFORM_BLOCK_BYTES)
        device.release_buffer(("m", "opaque"))
        self.assertTrue(device.is_empty)
        with self.assertRaises(KeyError):
            device.release_buffer(("m", "opaque"))


if __name__ == "__main__":
    unittest.main()
