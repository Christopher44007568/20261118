"""Tests for incremental scene-graph propagation."""

import math
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scene import Mat4, SceneGraph, render  # noqa: E402
from scene.graph import Node  # noqa: E402
from scene.meshes import make_cube, make_pyramid  # noqa: E402


def build_scene() -> SceneGraph:
    graph = SceneGraph()
    root = graph.root
    vehicle = root.add_child(Node("vehicle", Mat4.translation(0, 0, 0)))
    chassis = vehicle.add_child(
        Node("chassis", Mat4.translation(0, 1, 0), make_cube("m_chassis", 2.0)))
    turret = chassis.add_child(
        Node("turret", Mat4.translation(0, 1.5, 0), make_pyramid("m_turret", 1.5, 1.0)))
    turret.add_child(Node("barrel", Mat4.translation(0, 0.8, 0.8),
                          make_cube("m_barrel", 0.4)))
    for i in range(4):
        chassis.add_child(Node(f"wheel{i}", Mat4.translation(-1.2 + 2.4 * (i % 2),
                               -0.5, -1.2 + 2.4 * (i // 2)),
                               make_cube(f"m_wheel{i}", 0.6)))
    scenery = root.add_child(Node("scenery", Mat4.translation(8, 0, 0)))
    scenery.add_child(Node("tree", Mat4.identity(), make_pyramid("m_tree", 2.0, 4.0)))
    scenery.add_child(Node("rock", Mat4.translation(3, 0, 2), make_cube("m_rock", 1.2)))
    graph.full_rebuild()
    return graph


def find(graph, name):
    return next(n for n in graph.root.iter_subtree() if n.name == name)


def assert_matches_full_rebuild(testcase, graph):
    before = graph.snapshot()
    frame_inc = render(graph).digest()
    graph.full_rebuild()
    after = graph.snapshot()
    frame_full = render(graph).digest()
    for name in before:
        w0, a0, s0, _ = before[name]
        w1, a1, s1, _ = after[name]
        testcase.assertTrue(w0.almost_equal(w1), f"world mismatch: {name}")
        testcase.assertTrue(a0.almost_equal(a1), f"world aabb mismatch: {name}")
        testcase.assertTrue(s0.almost_equal(s1), f"subtree aabb mismatch: {name}")
    testcase.assertEqual(frame_inc, frame_full, "render differs from full rebuild")


class TestIncrementalPropagation(unittest.TestCase):
    def test_move_only_touches_subtree(self):
        graph = build_scene()
        vehicle = find(graph, "vehicle")
        untouched = {n.name: n.world for n in find(graph, "scenery").iter_subtree()}
        stats = graph.move(vehicle, Mat4.translation(5, 0, 0))
        # vehicle subtree has 8 nodes; +1 ancestor (root) for bounds.
        self.assertEqual(stats.matrix_computations, 8)
        self.assertEqual(stats.nodes_visited, 9)
        self.assertEqual(stats.gpu_upload_bytes, 0)
        for name, cached in untouched.items():
            self.assertIs(find(graph, name).world, cached)
        assert_matches_full_rebuild(self, graph)

    def test_move_leaf_visits_minimum(self):
        graph = build_scene()
        barrel = find(graph, "barrel")
        stats = graph.move(barrel, Mat4.translation(0, 1.0, 1.0))
        self.assertEqual(stats.matrix_computations, 1)
        assert_matches_full_rebuild(self, graph)

    def test_hide_and_show(self):
        graph = build_scene()
        turret = find(graph, "turret")
        visible_frame = render(graph).digest()
        stats = graph.set_visible(turret, False)
        self.assertEqual(stats.matrix_computations, 0)
        self.assertNotEqual(render(graph).digest(), visible_frame)
        assert_matches_full_rebuild(self, graph)
        graph.undo()
        self.assertEqual(render(graph).digest(), visible_frame)
        assert_matches_full_rebuild(self, graph)

    def test_delete_frees_gpu_and_undo_reuploads(self):
        graph = build_scene()
        turret = find(graph, "turret")
        handles = {n.name: n.gpu_handle for n in turret.iter_subtree()}
        resident_before = graph.device.resident_bytes
        del_stats = graph.delete(turret)
        self.assertGreater(del_stats.gpu_freed_bytes, 0)
        self.assertEqual(graph.device.resident_bytes,
                         resident_before - del_stats.gpu_freed_bytes)
        for handle in handles.values():
            self.assertFalse(graph.device.is_resident(handle))
        assert_matches_full_rebuild(self, graph)

        undo_stats = graph.undo()
        self.assertEqual(undo_stats.gpu_upload_bytes, del_stats.gpu_freed_bytes)
        self.assertEqual(graph.device.resident_bytes, resident_before)
        for name in handles:
            self.assertTrue(graph.device.is_resident(find(graph, name).gpu_handle))
        assert_matches_full_rebuild(self, graph)

    def test_undo_move_restores_render(self):
        graph = build_scene()
        baseline = render(graph).digest()
        graph.move(find(graph, "vehicle"),
                   Mat4.translation(3, 0, -1) * Mat4.rotation_y(0.7))
        self.assertNotEqual(render(graph).digest(), baseline)
        graph.undo()
        self.assertEqual(render(graph).digest(), baseline)
        assert_matches_full_rebuild(self, graph)

    def test_random_ops_match_full_rebuild(self):
        rng = random.Random(20261118)
        graph = build_scene()
        for step in range(30):
            nodes = [n for n in graph.root.iter_subtree() if n.parent is not None]
            target = rng.choice(nodes)
            op = rng.random()
            if op < 0.5:
                graph.move(target, Mat4.translation(
                    rng.uniform(-5, 5), rng.uniform(-2, 2), rng.uniform(-5, 5)))
            elif op < 0.75:
                graph.set_visible(target, rng.random() < 0.5)
            else:
                graph.delete(target)
            assert_matches_full_rebuild(self, graph)
            if rng.random() < 0.5 and graph.commands:
                graph.undo()
                assert_matches_full_rebuild(self, graph)


if __name__ == "__main__":
    unittest.main()
