"""Each variant enables only the shader features it actually needs."""

import unittest

from matvariants import (
    GPUDevice,
    MaterialManager,
    ShaderFeature,
    TextureSlot,
    VARIANT_FEATURES,
    Variant,
)


def make_textured_manager():
    device = GPUDevice()
    manager = MaterialManager(device)
    material = manager.create_material("rock")
    for slot in TextureSlot:
        material.set_texture(slot, f"{slot.value}_tex", 64, 64)
    return device, manager, material


class VariantFeatureTests(unittest.TestCase):
    def test_five_variants_defined(self) -> None:
        self.assertEqual(
            set(Variant),
            {
                Variant.OPAQUE,
                Variant.MASKED,
                Variant.TRANSPARENT,
                Variant.DOUBLE_SIDED,
                Variant.SHADOW,
            },
        )

    def test_opaque_has_only_map_features(self) -> None:
        self.assertEqual(
            VARIANT_FEATURES[Variant.OPAQUE],
            {
                ShaderFeature.ALBEDO_MAP,
                ShaderFeature.NORMAL_MAP,
                ShaderFeature.METALLIC_ROUGHNESS_MAP,
                ShaderFeature.EMISSIVE_MAP,
            },
        )

    def test_masked_adds_alpha_test_only(self) -> None:
        diff = VARIANT_FEATURES[Variant.MASKED] - VARIANT_FEATURES[Variant.OPAQUE]
        self.assertEqual(diff, {ShaderFeature.ALPHA_TEST})

    def test_transparent_adds_blend_only_and_no_depth_write(self) -> None:
        diff = (
            VARIANT_FEATURES[Variant.TRANSPARENT]
            - VARIANT_FEATURES[Variant.OPAQUE]
        )
        self.assertEqual(diff, {ShaderFeature.ALPHA_BLEND})
        from matvariants import VARIANT_SPECS

        self.assertTrue(VARIANT_SPECS[Variant.TRANSPARENT].blend)
        self.assertFalse(VARIANT_SPECS[Variant.TRANSPARENT].depth_write)

    def test_double_sided_adds_one_keyword_and_disables_culling(self) -> None:
        diff = (
            VARIANT_FEATURES[Variant.DOUBLE_SIDED]
            - VARIANT_FEATURES[Variant.OPAQUE]
        )
        self.assertEqual(diff, {ShaderFeature.DOUBLE_SIDED})
        from matvariants import VARIANT_SPECS

        self.assertFalse(VARIANT_SPECS[Variant.DOUBLE_SIDED].cull_back)

    def test_shadow_is_minimal_depth_only_program(self) -> None:
        self.assertEqual(
            VARIANT_FEATURES[Variant.SHADOW], {ShaderFeature.SHADOW_PASS}
        )
        from matvariants import VARIANT_SPECS

        self.assertEqual(VARIANT_SPECS[Variant.SHADOW].texture_slots, frozenset())
        self.assertTrue(VARIANT_SPECS[Variant.SHADOW].depth_write)

    def test_shadow_needs_no_textures(self) -> None:
        device, manager, material = make_textured_manager()
        manager.shutdown()
        bare = MaterialManager(device).create_material("bare")
        # No textures assigned at all: shadow variant still applies.
        bare.get_variant(Variant.SHADOW).ensure_resident()
        self.assertEqual(bare.active_variant_count, 1)

    def test_lighting_variant_without_texture_raises(self) -> None:
        from matvariants import RenderContext
        from matvariants.material import MissingTextureError

        device = GPUDevice()
        material = MaterialManager(device).create_material("untextured")
        with self.assertRaises(MissingTextureError):
            material.get_variant(Variant.OPAQUE).apply(RenderContext(device))


if __name__ == "__main__":
    unittest.main()
