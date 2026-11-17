"""Demo: incremental transform propagation in a scene tree.

Builds a small scene, then performs move / hide / delete / undo while
printing per-operation instrumentation (visited nodes, matrix computes,
GPU upload/free bytes). After every edit the incremental caches and the
rendered frame are compared against a brute-force full rebuild.
"""

from __future__ import annotations

import math

from scene import GpuDevice, Mat4, SceneGraph, render
from scene.meshes import make_cube, make_pyramid


def build_scene() -> SceneGraph:
    device = GpuDevice()
    graph = SceneGraph(device)
    root = graph.root

    vehicle = root.add_child(_node(graph, "vehicle", Mat4.translation(0, 0, 0)))
    chassis = vehicle.add_child(_node(graph, "chassis", Mat4.translation(0, 1, 0),
                                      make_cube("chassis_mesh", 2.0)))
    turret = chassis.add_child(_node(graph, "turret", Mat4.translation(0, 1.5, 0),
                                     make_pyramid("turret_mesh", 1.5, 1.0)))
    turret.add_child(_node(graph, "barrel", Mat4.translation(0, 0.8, 0.8),
                           make_cube("barrel_mesh", 0.4)))
    for i, (x, z) in enumerate([(-1.2, -1.2), (1.2, -1.2), (-1.2, 1.2), (1.2, 1.2)]):
        chassis.add_child(_node(graph, f"wheel{i}", Mat4.translation(x, -0.5, z),
                                make_cube(f"wheel_mesh{i}", 0.6)))

    scenery = root.add_child(_node(graph, "scenery", Mat4.translation(8, 0, 0)))
    scenery.add_child(_node(graph, "tree", Mat4.translation(0, 0, 0),
                            make_pyramid("tree_mesh", 2.0, 4.0)))
    scenery.add_child(_node(graph, "rock", Mat4.translation(3, 0, 2),
                            make_cube("rock_mesh", 1.2)))
    return graph


def _node(graph: SceneGraph, name, local, mesh=None):
    from scene import Node
    return Node(name, local, mesh)


def find(graph: SceneGraph, name: str):
    for n in graph.root.iter_subtree():
        if n.name == name:
            return n
    raise KeyError(name)


def main() -> None:
    graph = build_scene()
    total_nodes = sum(1 for _ in graph.root.iter_subtree())
    print(f"scene built: {total_nodes} nodes, "
          f"gpu resident = {graph.device.resident_bytes}B")

    graph.full_rebuild()
    baseline_frame = render(graph).digest()
    print(f"baseline render: {baseline_frame[:12]}...\n")

    # 1. Move the vehicle: only its subtree is recomputed.
    vehicle = find(graph, "vehicle")
    scenery_world_before = find(graph, "scenery").world
    tree_world_before = find(graph, "tree").world
    stats = graph.move(vehicle, Mat4.translation(4, 0, -2) * Mat4.rotation_y(math.pi / 4))
    print(f"[move vehicle]   {stats.summary()}")
    assert find(graph, "scenery").world is scenery_world_before
    assert find(graph, "tree").world is tree_world_before
    print("  [OK] scenery subtree kept cached world matrices (untouched objects)")
    check_consistent(graph, "after move")

    # 2. Hide the turret: no matrix work at all.
    turret = find(graph, "turret")
    stats = graph.set_visible(turret, False)
    print(f"\n[hide turret]    {stats.summary()}")
    check_consistent(graph, "after hide")

    # 3. Show it again, then delete it: GPU buffers are released.
    graph.undo()
    resident_before = graph.device.resident_bytes
    stats = graph.delete(turret)
    print(f"\n[delete turret]  {stats.summary()}")
    assert graph.device.resident_bytes < resident_before
    print(f"  [OK] gpu resident {resident_before}B -> "
          f"{graph.device.resident_bytes}B after delete")
    check_consistent(graph, "after delete")

    # 4. Undo the delete: meshes are re-uploaded, caches rebuilt.
    stats = graph.undo()
    print(f"\n[undo delete]    {stats.summary()}")
    assert graph.device.resident_bytes == resident_before
    assert stats.gpu_upload_bytes > 0
    print(f"  [OK] gpu re-uploaded {stats.gpu_upload_bytes}B, "
          f"resident back to {graph.device.resident_bytes}B")
    check_consistent(graph, "after undo(delete)")

    # 5. Undo the move: render must return to the baseline.
    stats = graph.undo()
    print(f"\n[undo move]      {stats.summary()}")
    check_consistent(graph, "after undo(move)")
    restored = render(graph).digest()
    assert restored == baseline_frame
    print(f"  [OK] render matches baseline ({restored[:12]}...)")

    print("\nall incremental updates are consistent with full rebuilds.")
def check_consistent(graph: SceneGraph, label: str) -> None:
    """Incremental caches and render must match a full rebuild exactly."""
    before = graph.snapshot()
    frame_inc = render(graph).digest()
    graph.full_rebuild()
    after = graph.snapshot()
    frame_full = render(graph).digest()
    for name in before:
        w0, a0, s0, v0 = before[name]
        w1, a1, s1, v1 = after[name]
        assert w0.almost_equal(w1), f"{label}: world matrix mismatch at {name}"
        assert a0.almost_equal(a1), f"{label}: world aabb mismatch at {name}"
        assert s0.almost_equal(s1), f"{label}: subtree aabb mismatch at {name}"
        assert v0 == v1, f"{label}: visibility mismatch at {name}"
    assert frame_inc == frame_full, f"{label}: render mismatch vs full rebuild"
    print(f"  [OK] {label}: incremental == full rebuild "
          f"(render {frame_inc[:12]}...)")


if __name__ == "__main__":
    main()
