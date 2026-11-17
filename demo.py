"""End-to-end demonstration of the material variant system.

Run with::

    python3 demo.py
"""

from __future__ import annotations

from matvariants import (
    DrawItem,
    FrameRenderer,
    GPUDevice,
    MaterialManager,
    RenderContext,
    TextureSlot,
    Variant,
)


def human_size(num_bytes: int) -> str:
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:8.2f} {unit}"
        size /= 1024
    return f"{num_bytes} B"


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def main() -> None:
    device = GPUDevice()
    manager = MaterialManager(device)
    rock = manager.create_material("rock")
    for slot in TextureSlot:
        rock.set_texture(slot, f"rock_{slot.value}", width=256, height=256)

    section("1. Shader features per variant (only necessary keywords)")
    for kind in Variant:
        spec = rock.get_variant(kind)
        keywords = ", ".join(feature.value for feature in sorted(
            spec.features, key=lambda feature: feature.value
        ))
        print(f"  {kind.value:<12} queue={spec.spec.render_queue:<5} {keywords}")

    section("2. Lazy activation: active variant count grows on demand")
    print(f"  active={rock.active_variant_count} cached={rock.cached_variant_count}")
    for kind in Variant:
        rock.get_variant(kind).ensure_resident()
        print(
            f"  after {kind.value:<12} "
            f"active={rock.active_variant_count} cached={rock.cached_variant_count}"
        )

    section("3. VRAM estimate (all five variants resident)")
    estimate = rock.vram_estimate()
    for label in ("textures", "programs", "uniforms", "total"):
        print(f"  {label:<10}{human_size(estimate[label])}")
    stats = manager.stats()
    print(
        f"  device total={human_size(device.used_vram_bytes)} "
        f"textures={stats['textures_resident']} programs={stats['programs_resident']}"
    )

    section("4. Variant switching synchronizes textures and uniforms")
    context = RenderContext(device)
    rock.get_variant(Variant.OPAQUE).apply(context)
    print("  opaque slots :", sorted(slot.value for slot in context.texture_bindings))
    rock.get_variant(Variant.SHADOW).apply(context)
    print("  shadow slots :", context.texture_bindings or "(none, depth-only)")
    rock.get_variant(Variant.MASKED).apply(context)
    print("  masked extra uniform alpha_cutoff =", context.uniforms["alpha_cutoff"])

    section("5. Parameter change invalidates all related variants")
    before = device.used_vram_bytes
    rock.set_param("roughness", 0.25)
    after = device.used_vram_bytes
    print(f"  version bumped to {rock.version}, active variants -> {rock.active_variant_count}")
    print(f"  GPU state evicted: {human_size(before - after)}")
    rock.get_variant(Variant.TRANSPARENT).apply(context)
    print(
        "  rebuilt transparent variant reads roughness =",
        context.uniforms["roughness"],
    )

    section("6. Render order: shadow -> opaque(front-to-back) -> transparent(back-to-front)")
    renderer = FrameRenderer(context)
    renderer.submit(DrawItem(rock.get_variant(Variant.SHADOW), "shadow_pass", 9.0))
    renderer.submit(DrawItem(rock.get_variant(Variant.OPAQUE), "near", 1.0))
    renderer.submit(DrawItem(rock.get_variant(Variant.OPAQUE), "far", 8.0))
    renderer.submit(DrawItem(rock.get_variant(Variant.TRANSPARENT), "glass_near", 2.0))
    renderer.submit(DrawItem(rock.get_variant(Variant.TRANSPARENT), "glass_far", 7.0))
    for entry in renderer.render():
        print(
            f"  queue={entry['queue']:<5} {entry['variant']:<11} "
            f"mesh={entry['mesh']:<10} depth={entry['depth']}"
        )

    section("7. Delete + rebuild leaves no cached GPU state")
    manager.delete_material("rock")
    print(f"  device empty after delete: {device.is_empty} ({device.used_vram_bytes} bytes)")
    rebuilt = manager.recreate_material("rock")
    print(
        f"  rebuilt material: version={rebuilt.version} "
        f"active={rebuilt.active_variant_count} cached={rebuilt.cached_variant_count}"
    )
    manager.shutdown()
    print(f"  device empty after shutdown: {device.is_empty}")


if __name__ == "__main__":
    main()
