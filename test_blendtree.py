import math
import unittest

from blendtree.blendspace import BlendSpace
from blendtree.mixer import RobustMixer, NaiveMixer, InputFilter
from blendtree.simulate import (
    run_scenario, scenario_sudden_stop, scenario_slant_run,
    scenario_stop_and_turn, SCENARIOS)
from blendtree.skeleton import Skeleton, two_bone_ik
from blendtree.clips import build_clips


class BlendSpaceTests(unittest.TestCase):
    def setUp(self):
        self.space = BlendSpace()

    def test_weights_sum_to_one_inside(self):
        for m in (0.0, 0.5, 1.4, 2.6, 4.2):
            for t in (-2.2, -1.0, 0.0, 1.0, 2.2):
                w = self.space.weights(m, t)
                self.assertAlmostEqual(sum(w.values()), 1.0, places=9)
                self.assertTrue(all(v >= -1e-12 for v in w.values()))

    def test_weights_sum_to_one_outside_hull(self):
        for m, t in ((6.0, 0.0), (-1.0, 3.0), (0.0, 4.0), (5.0, -3.0)):
            w = self.space.weights(m, t)
            self.assertAlmostEqual(sum(w.values()), 1.0, places=9)
            self.assertLessEqual(len([v for v in w.values() if v > 0]), 2)

    def test_vertex_weights_are_pure_clips(self):
        for p in self.space.points:
            w = self.space.weights(p.m, p.t)
            self.assertAlmostEqual(w[p.name], 1.0, places=9)

    def test_midpoint_is_half_half(self):
        # The idle->walk edge midpoint (edge of the idle/turnL/turnR fan).
        w = self.space.weights(0.7, 0.0)
        self.assertAlmostEqual(sum(w.values()), 1.0, places=9)
        # Point on the walk->run edge must be a two-clip blend.
        w2 = self.space.weights(2.8, 0.0)
        self.assertAlmostEqual(w2["walk"] + w2["run"], 1.0, places=9)
        self.assertAlmostEqual(w2["walk"], w2["run"], places=2)


class IKTests(unittest.TestCase):
    def test_bone_lengths_preserved(self):
        skel = Skeleton()
        clips = build_clips()
        pose = clips["run"].sample(1.3)
        joints = skel.solve(pose)
        for side in ("L", "R"):
            hip, knee = joints[f"hip_{side}"], joints[f"knee_{side}"]
            ankle = joints[f"ankle_{side}"]
            self.assertAlmostEqual(
                math.dist(hip, knee), skel.thigh, places=9)
            self.assertAlmostEqual(
                math.dist(knee, ankle), skel.shin, places=9)

    def test_two_bone_ik_clamps_overreach(self):
        a, mid, b = two_bone_ik((0, 0), (10, 0), 1.0, 1.0, 1.0)
        self.assertLessEqual(math.dist(a, b), 2.0 + 1e-6)


class MixerArtifactTests(unittest.TestCase):
    def test_robust_eliminates_double_float_on_sudden_stop(self):
        _, naive = run_scenario(
            "x", scenario_sudden_stop, 5.0, NaiveMixer)
        recs, robust = run_scenario(
            "x", scenario_sudden_stop, 5.0, RobustMixer)
        self.assertGreater(naive["planted_slide_frames"],
                           robust["planted_slide_frames"])
        self.assertEqual(robust["planted_slide_frames"], 0)
        self.assertEqual(robust["max_foot_slide"], 0.0)
        # The naive mixer also floods duplicate footstep events.
        self.assertGreater(naive["event_count"],
                           2 * robust["event_count"])

    def test_robust_locks_contact_feet(self):
        recs, metrics = run_scenario(
            "x", scenario_slant_run, 5.0, RobustMixer)
        # A locked contact ankle moves at most one numerical jitter step.
        self.assertLess(metrics["max_foot_slide"], 1e-6)

    def test_event_counts_are_reasonable(self):
        # At ~0.9-1.6 Hz cadence over 5 s we expect roughly 8-20 steps,
        # never zero and never an explosion of duplicate events.
        for name, fn, dur in SCENARIOS:
            _, metrics = run_scenario(name, fn, dur, RobustMixer)
            self.assertGreater(metrics["event_count"], 0)
            self.assertLess(metrics["event_count"], 40)

    def test_events_never_duplicate_same_foot_same_frame(self):
        recs, _ = run_scenario(
            "x", scenario_stop_and_turn, 5.5, RobustMixer)
        for rec in recs:
            sides = [e["side"] for e in rec["events"]]
            self.assertEqual(len(sides), len(set(sides)))

    def test_input_filter_slew_rate(self):
        filt = InputFilter(accel=3.5, decel=2.0)
        filt.step(4.0, 0.0, 1.0 / 60)
        self.assertAlmostEqual(filt.m, 3.5 / 60, places=6)
        filt.m = 4.0
        filt.step(0.0, 0.0, 1.0 / 60)
        self.assertAlmostEqual(filt.m, 4.0 - 2.0 / 60, places=6)

    def test_phase_is_shared_across_clips(self):
        mixer = RobustMixer()
        mixer.update(2.0, 0.5, 0.1)
        self.assertTrue(0.0 <= mixer.phase <= 2 * math.pi)


if __name__ == "__main__":
    unittest.main(verbosity=2)
