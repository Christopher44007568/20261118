"""Base parameter changes must invalidate every related variant."""

import unittest

from matvariants import GPUDevice, MaterialManager, RenderContext, Variant
from tests.test_variants import make_textured_manager


class InvalidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.device, self.manager, self.material = make_textured_manager()
        self.manager.warm_all_variants(self.material)
        self.context = RenderContext(self.device)

    def test_all_variants_resident_after_warmup(self) -> None:
        self.assertEqual(self.material.active_variant_count, 5)
        self.assertEqual(self.material.cached_variant_count, 5)

    def test_param_change_evicts_all_variant_gpu_state(self) -> None:
        version_before = self.material.version
        self.material.set_param("roughness", 0.25)
        self.assertEqual(self.material.version, version_before + 1)
        self.assertEqual(self.material.active_variant_count, 0)
        # Variant objects stay cached and rebuild lazily.
        self.assertEqual(self.material.cached_variant_count, 5)

    def test_rebuilt_variant_picks_up_new_param(self) -> None:
        self.material.set_param("metallic", 0.9)
        variant = self.material.get_variant(Variant.OPAQUE)
        variant.apply(self.context)
        self.assertEqual(self.context.uniforms["metallic"], 0.9)
        self.assertEqual(variant.built_version, self.material.version)

    def test_propagation_to_every_variant_kind(self) -> None:
        self.material.set_param("base_color", (0.2, 0.4, 0.6, 1.0))
        for kind in (
            Variant.OPAQUE,
            Variant.MASKED,
            Variant.TRANSPARENT,
            Variant.DOUBLE_SIDED,
        ):
            variant = self.material.get_variant(kind)
            variant.apply(self.context)
            self.assertEqual(
                self.context.uniforms["base_color"], (0.2, 0.4, 0.6, 1.0)
            )
            self.assertEqual(variant.built_version, self.material.version)

    def test_same_value_does_not_invalidate(self) -> None:
        version_before = self.material.version
        self.material.set_param("roughness", 0.8)
        self.assertEqual(self.material.version, version_before)
        self.assertEqual(self.material.active_variant_count, 5)

    def test_unknown_param_rejected(self) -> None:
        with self.assertRaises(KeyError):
            self.material.set_param("no_such_param", 1.0)

    def test_stale_variant_rebuilds_before_apply(self) -> None:
        variant = self.material.get_variant(Variant.MASKED)
        self.material.set_param("alpha_cutoff", 0.33)
        self.assertFalse(variant.is_resident)
        variant.apply(self.context)
        self.assertTrue(variant.is_resident)
        self.assertEqual(self.context.uniforms["alpha_cutoff"], 0.33)

    def test_repeated_changes_do_not_leak_programs(self) -> None:
        for step in range(5):
            self.material.set_param("roughness", step / 10.0)
            self.material.get_variant(Variant.OPAQUE).ensure_resident()
        features = self.material.get_variant(Variant.OPAQUE).features
        self.assertEqual(self.device.program_refcount(features), 1)

    def test_invalidated_variants_release_uniform_buffers(self) -> None:
        vram_before = self.device.used_vram_bytes
        self.material.set_param("roughness", 0.1)
        # Exactly five uniform blocks (one per previously active variant) gone.
        from matvariants.gpu import SHADER_PROGRAM_BYTES, UNIFORM_BLOCK_BYTES

        self.assertEqual(
            vram_before - self.device.used_vram_bytes,
            5 * UNIFORM_BLOCK_BYTES + 5 * SHADER_PROGRAM_BYTES,
        )
        self.assertEqual(self.material.active_variant_count, 0)


if __name__ == "__main__":
    unittest.main()
