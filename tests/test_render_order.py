"""Render-queue ordering and in-frame variant switching."""

import unittest

from matvariants import (
    DrawItem,
    FrameRenderer,
    GPUDevice,
    MaterialManager,
    RenderContext,
    TextureSlot,
    Variant,
)
from tests.test_variants import make_textured_manager


def item(material, kind: Variant, mesh_id: str, depth: float) -> DrawItem:
    return DrawItem(material.get_variant(kind), mesh_id, depth)


class RenderOrderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.device, self.manager, self.material = make_textured_manager()
        self.context = RenderContext(self.device)
        self.renderer = FrameRenderer(self.context)

    def test_shadow_before_opaque_before_transparent(self) -> None:
        self.renderer.submit(item(self.material, Variant.TRANSPARENT, "t", 5.0))
        self.renderer.submit(item(self.material, Variant.SHADOW, "s", 9.0))
        self.renderer.submit(item(self.material, Variant.OPAQUE, "o", 3.0))
        order = [entry["variant"] for entry in self.renderer.render()]
        self.assertEqual(order, ["shadow", "opaque", "transparent"])

    def test_opaque_front_to_back(self) -> None:
        self.renderer.submit(item(self.material, Variant.OPAQUE, "far", 9.0))
        self.renderer.submit(item(self.material, Variant.OPAQUE, "near", 1.0))
        self.renderer.submit(item(self.material, Variant.OPAQUE, "mid", 4.0))
        ordered = self.renderer.ordered_items
        self.assertEqual([draw.mesh_id for draw in ordered], ["near", "mid", "far"])

    def test_transparent_back_to_front(self) -> None:
        self.renderer.submit(item(self.material, Variant.TRANSPARENT, "near", 1.0))
        self.renderer.submit(item(self.material, Variant.TRANSPARENT, "far", 9.0))
        self.renderer.submit(item(self.material, Variant.TRANSPARENT, "mid", 4.0))
        ordered = self.renderer.ordered_items
        self.assertEqual([draw.mesh_id for draw in ordered], ["far", "mid", "near"])

    def test_masked_sits_within_opaque_bucket(self) -> None:
        self.renderer.submit(item(self.material, Variant.MASKED, "m", 2.0))
        self.renderer.submit(item(self.material, Variant.OPAQUE, "o", 8.0))
        self.renderer.submit(item(self.material, Variant.TRANSPARENT, "t", 1.0))
        ordered = self.renderer.ordered_items
        meshes = [draw.mesh_id for draw in ordered]
        # Both queue values are below the transparent cutoff; transparent last.
        self.assertTrue(
            all(draw.render_queue <= 2999 for draw in ordered[:-1])
        )
        self.assertEqual(meshes[:2], ["o", "m"])
        self.assertEqual(meshes[-1], "t")

    def test_forced_variant_sequence_rebinds_state(self) -> None:
        sequence = [
            Variant.OPAQUE,
            Variant.TRANSPARENT,
            Variant.SHADOW,
            Variant.DOUBLE_SIDED,
            Variant.MASKED,
        ]
        trace = self.renderer.render_sequence(self.material, sequence)
        self.assertEqual(
            [entry["variant"] for entry in trace],
            [kind.value for kind in sequence],
        )
        shadow_entry = trace[2]["context"]
        self.assertEqual(shadow_entry["textures"], {})
        masked_entry = trace[4]["context"]
        self.assertIn("alpha_cutoff", masked_entry["uniforms"])

    def test_frame_with_two_materials_and_mixed_queues(self) -> None:
        other = self.manager.create_material("metal")
        for slot in TextureSlot:
            other.set_texture(slot, f"metal_{slot.value}", 16, 16)
        self.renderer.submit(item(other, Variant.OPAQUE, "metal-o", 6.0))
        self.renderer.submit(item(self.material, Variant.OPAQUE, "rock-o", 2.0))
        self.renderer.submit(item(other, Variant.TRANSPARENT, "metal-t", 4.0))
        trace = self.renderer.render()
        self.assertEqual(
            [(entry["variant"], entry["mesh"]) for entry in trace],
            [
                ("opaque", "rock-o"),
                ("opaque", "metal-o"),
                ("transparent", "metal-t"),
            ],
        )
        self.assertEqual(self.manager.total_active_variants, 3)


if __name__ == "__main__":
    unittest.main()
