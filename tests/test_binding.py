"""Variant switching must synchronize texture bindings and uniforms."""

import unittest

from matvariants import (
    COMMON_UNIFORMS,
    GPUDevice,
    MaterialManager,
    RenderContext,
    TextureSlot,
    Variant,
)
from tests.test_variants import make_textured_manager


class BindingSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.device, self.manager, self.material = make_textured_manager()
        self.context = RenderContext(self.device)

    def test_apply_binds_program_slots_and_uniforms(self) -> None:
        self.material.get_variant(Variant.OPAQUE).apply(self.context)
        self.assertEqual(
            frozenset(self.context.texture_bindings),
            self.material.get_variant(Variant.OPAQUE).spec.texture_slots,
        )
        for uniform in COMMON_UNIFORMS:
            self.assertIn(uniform, self.context.uniforms)

    def test_masked_carries_alpha_cutoff_uniform(self) -> None:
        self.material.get_variant(Variant.MASKED).apply(self.context)
        self.assertIn("alpha_cutoff", self.context.uniforms)
        self.assertEqual(self.context.uniforms["alpha_cutoff"], 0.5)

    def test_transparent_carries_opacity_uniform(self) -> None:
        self.material.get_variant(Variant.TRANSPARENT).apply(self.context)
        self.assertIn("opacity", self.context.uniforms)

    def test_shadow_clears_texture_slots_and_lighting_uniforms(self) -> None:
        self.material.get_variant(Variant.OPAQUE).apply(self.context)
        self.assertEqual(len(self.context.texture_bindings), 4)
        self.material.get_variant(Variant.SHADOW).apply(self.context)
        self.assertEqual(self.context.texture_bindings, {})
        self.assertEqual(self.context.uniforms, {})

    def test_switching_variants_rebinds_every_required_slot(self) -> None:
        self.material.get_variant(Variant.OPAQUE).apply(self.context)
        self.material.get_variant(Variant.SHADOW).apply(self.context)
        self.material.get_variant(Variant.DOUBLE_SIDED).apply(self.context)
        bound = set(self.context.texture_bindings)
        self.assertEqual(
            bound, set(TextureSlot), "lighting variant must rebind all maps"
        )
        for slot in TextureSlot:
            self.assertEqual(
                self.context.texture_bindings[slot], f"{slot.value}_tex"
            )

    def test_texture_replacement_is_reflected_on_next_apply(self) -> None:
        self.material.get_variant(Variant.OPAQUE).apply(self.context)
        self.material.set_texture(TextureSlot.ALBEDO, "albedo_v2", 64, 64)
        self.material.get_variant(Variant.OPAQUE).apply(self.context)
        self.assertEqual(
            self.context.texture_bindings[TextureSlot.ALBEDO], "albedo_v2"
        )
        self.assertNotIn("albedo_tex", self.device.resident_texture_names)

    def test_program_change_resets_context_state(self) -> None:
        self.material.get_variant(Variant.OPAQUE).apply(self.context)
        self.material.get_variant(Variant.SHADOW).apply(self.context)
        # No stale lighting uniforms survive the program switch.
        self.assertNotIn("base_color", self.context.uniforms)


if __name__ == "__main__":
    unittest.main()
