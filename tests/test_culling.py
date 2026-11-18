"""遮挡剔除状态机的单元测试。"""

from __future__ import annotations

import sys
import os

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from occlusion_demo.culling import (  # noqa: E402
    MAX_QUERY_AGE,
    OcclusionState,
    QueryRecord,
    aabb_in_frustum,
    extract_planes,
)


class FakeQuery:
    def __init__(self, ready: bool, samples: int):
        self._ready = ready
        self._samples = samples
        self.extra = None

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def samples(self) -> int:
        return self._samples


class FakePool:
    def __init__(self):
        self.released = 0

    def release(self, query) -> None:
        self.released += 1


def test_first_seen_is_conservative():
    state = OcclusionState(1)
    status, draw = state.decide(0, 0)
    assert status == "delayed" and draw is True


def test_occluded_result_skips_draw_but_visible_result_draws():
    state = OcclusionState(1)
    pool = FakePool()
    state.issue(0, 0, FakeQuery(True, 0))
    state.resolve_previous(1, pool)
    assert state.decide(0, 1) == ("occluded", False)

    state.issue(0, 2, FakeQuery(True, 120))
    state.resolve_previous(3, pool)
    assert state.decide(0, 3) == ("passed", True)
    assert pool.released == 2


def test_stale_result_falls_back_to_conservative():
    state = OcclusionState(1)
    pool = FakePool()
    state.issue(0, 0, FakeQuery(True, 0))  # 曾被遮挡
    state.resolve_previous(1, pool)
    stale_frame = 1 + MAX_QUERY_AGE + 1
    assert state.decide(0, stale_frame) == ("delayed", True)


def test_unready_query_keeps_previous_decision():
    state = OcclusionState(1)
    pool = FakePool()
    state.issue(0, 0, FakeQuery(True, 5))
    state.resolve_previous(1, pool)
    state.issue(0, 1, FakeQuery(False, 0))
    state.resolve_previous(2, pool)  # 未就绪
    assert state.decide(0, 2) == ("passed", True)


def test_unready_limit_forces_conservative():
    state = OcclusionState(1)
    rec: QueryRecord = state.records[0]
    rec.last_visible = False
    rec.last_result_frame = 0
    rec.unready_count = 4
    assert state.decide(0, 1) == ("delayed", True)


def test_frustum_planes_reject_behind_camera():
    fov = np.deg2rad(60.0)
    f = 1.0 / np.tan(fov / 2.0)
    near, far = 0.1, 100.0
    proj = np.zeros((4, 4), dtype="f4")
    proj[0, 0] = f
    proj[1, 1] = f
    proj[2, 2] = (far + near) / (near - far)
    proj[2, 3] = (2 * far * near) / (near - far)
    proj[3, 2] = -1.0
    # 相机在原点朝 -z 看，视锥内点的眼睛空间 z 为负。
    planes = extract_planes(proj)
    center = np.array([0.0, 0.0, 5.0], dtype="f4")
    half = np.array([0.5, 0.5, 0.5], dtype="f4")
    assert aabb_in_frustum(center, half, planes) is False
    center_in = np.array([0.0, 0.0, -5.0], dtype="f4")
    assert aabb_in_frustum(center_in, half, planes) is True


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("PASS", name)
