"""Frame-level draw submission and render-queue ordering."""

from __future__ import annotations

from dataclasses import dataclass

from .features import QUEUE_OPAQUE_MAX, Variant
from .gpu import RenderContext
from .material import BaseMaterial, MaterialVariant


@dataclass
class DrawItem:
    """One draw call: a material variant, a mesh id and camera-space depth."""

    variant: MaterialVariant
    mesh_id: str
    depth: float

    @property
    def render_queue(self) -> int:
        return self.variant.spec.render_queue


class FrameRenderer:
    """Sorts draw items and applies each variant through a render context."""

    def __init__(self, context: RenderContext) -> None:
        self.context = context
        self._items: list[DrawItem] = []

    def submit(self, item: DrawItem) -> None:
        self._items.append(item)

    def clear(self) -> None:
        self._items.clear()

    @staticmethod
    def sort_items(items: list[DrawItem]) -> list[DrawItem]:
        """Order by render queue, then depth.

        Opaque queues (``<= QUEUE_OPAQUE_MAX``) render front-to-back to
        minimize overdraw; blended queues render back-to-front for correct
        alpha compositing.
        """
        def sort_key(item: DrawItem) -> tuple[int, float, str]:
            if item.render_queue <= QUEUE_OPAQUE_MAX:
                depth_key = item.depth
            else:
                depth_key = -item.depth
            return (item.render_queue, depth_key, item.mesh_id)

        return sorted(items, key=sort_key)

    @property
    def ordered_items(self) -> list[DrawItem]:
        return self.sort_items(self._items)

    def render(self) -> list[dict[str, object]]:
        """Apply every submitted variant in sorted order and return a trace."""
        trace: list[dict[str, object]] = []
        for item in self.ordered_items:
            item.variant.apply(self.context)
            trace.append(
                {
                    "mesh": item.mesh_id,
                    "variant": item.variant.kind.value,
                    "queue": item.render_queue,
                    "depth": item.depth,
                    "context": self.context.snapshot(),
                }
            )
        self.clear()
        return trace

    def render_sequence(
        self, material: BaseMaterial, kinds: list[Variant]
    ) -> list[dict[str, object]]:
        """Apply the given variants of one material in a forced order."""
        trace = []
        for index, kind in enumerate(kinds):
            material.get_variant(kind).apply(self.context)
            trace.append(
                {
                    "order": index,
                    "variant": kind.value,
                    "context": self.context.snapshot(),
                }
            )
        return trace
