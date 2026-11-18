"""保守遮挡剔除状态机。

GPU 遮挡查询是异步的：本帧发出的查询最早只能在后续帧取回。
规则：
* 从未查询过的物体一律保守绘制（首次可见）；
* 只信任“最近一次且未过时”的查询结果，年龄超过 MAX_QUERY_AGE 即作废；
* 查询结果未就绪时沿用上一次已知结论，同样保守处理；
* 被判定遮挡的物体仍每帧提交包围盒查询，一旦重新露出立即恢复绘制。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

MAX_QUERY_AGE = 1          # 超过 1 帧的结果视为过时（多帧延迟时保守处理）
UNREADY_LIMIT = 4          # 连续未就绪帧数上限，超过即保守绘制


@dataclass
class QueryRecord:
    query: object = None
    issued_frame: int = -1
    last_visible: bool = True
    last_result_frame: int = -10_000
    unready_count: int = 0
    outside_frames: int = 0


def extract_planes(view_proj: np.ndarray) -> list[tuple[np.ndarray, float]]:
    """从 view-proj 矩阵提取 6 个视锥平面 (法线, 偏移)，法线朝内。"""
    m = view_proj
    rows = [m[i, :] for i in range(4)]
    raw = [
        rows[3] + rows[0], rows[3] - rows[0],
        rows[3] + rows[1], rows[3] - rows[1],
        rows[3] + rows[2], rows[3] - rows[2],
    ]
    planes = []
    for coef in raw:
        normal = coef[:3]
        length = float(np.linalg.norm(normal)) or 1.0
        planes.append((normal / length, float(coef[3]) / length))
    return planes


def aabb_in_frustum(center: np.ndarray, half: np.ndarray,
                    planes: list[tuple[np.ndarray, float]]) -> bool:
    for normal, offset in planes:
        radius = float(np.abs(normal) @ half)
        if float(normal @ center) + offset < -radius:
            return False
    return True


class OcclusionState:
    """每个被查询物体的历史状态与本帧决策。"""

    def __init__(self, target_count: int):
        self.records = [QueryRecord() for _ in range(target_count)]
        self.last_stats: dict[str, int] = {}

    def resolve_previous(self, frame_index: int, pool) -> None:
        """帧初取回已经到期的查询结果，未就绪/过时则保留保守结论。"""
        for rec in self.records:
            if rec.query is None:
                continue
            if rec.query is None:
                rec.unready_count += 1
                continue
            if not rec.query.ready:
                rec.unready_count += 1
                continue
            samples = rec.query.samples
            rec.unready_count = 0
            rec.last_visible = samples > 0
            rec.last_result_frame = frame_index
            pool.release(rec.query)
            rec.query = None

    def decide(self, index: int, frame_index: int) -> tuple[str, bool]:
        """返回 (状态, 本帧是否绘制实体)。状态用于界面统计。"""
        rec = self.records[index]
        if rec.outside_frames > 0:
            return "outside", False
        age = frame_index - rec.last_result_frame
        if age > MAX_QUERY_AGE:
            # 无有效结果（首次出现或结果过时）：保守绘制。
            return "delayed", True
        if rec.unready_count >= UNREADY_LIMIT:
            return "delayed", True
        if rec.last_visible:
            return "passed", True
        return "occluded", False

    def issue(self, index: int, frame_index: int, query) -> None:
        rec = self.records[index]
        rec.query = query
        rec.issued_frame = frame_index
        query.extra = index

    def mark_outside(self, index: int, outside: bool) -> None:
        rec = self.records[index]
        rec.outside_frames = rec.outside_frames + 1 if outside else 0
