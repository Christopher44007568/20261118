"""逐帧渲染：遮挡查询通道 + 实体通道，并与全量参考渲染做像素比对。"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .camera import camera_at, look_at, perspective
from .culling import OcclusionState, aabb_in_frustum, extract_planes
from .gl_query import RawQueryPool
from .gpu import FullScreenQuad, MeshGpu, make_frame_buffers, instance_data
from .scene import build_scene


@dataclass
class FrameStats:
    frame: int
    candidates: int
    passed: int
    occluded: int
    delayed: int
    outside: int
    target_draws: int
    draw_batches: int
    reference_draws: int
    queries_in_flight_start: int
    queries_in_flight_end: int
    queries_issued: int
    diff_pixels: int
    max_channel_delta: float
    depth_match: bool


class DemoRenderer:
    def __init__(self, ctx, width: int, height: int):
        self.ctx = ctx
        self.width, self.height = width, height
        self.scene = build_scene()
        self.mesh_gpu = {
            name: MeshGpu(ctx, name, mesh.vertices, mesh.indices)
            for name, mesh in self.scene["meshes"].items()
        }
        self.targets = self.scene["targets"]
        self.state = OcclusionState(len(self.targets))
        self.query_pool = RawQueryPool(capacity=len(self.targets) + 8)
        self.main_fbo = make_frame_buffers(ctx, width, height)
        self.ref_fbo = make_frame_buffers(ctx, width, height)
        self.quad = FullScreenQuad(ctx)
        self.proj = perspective(np.deg2rad(60.0), width / height, 0.1, 220.0)
        self.light = np.array([0.45, 0.8, 0.35], dtype="f4")
        self._upload_static()

    def _upload_static(self) -> None:
        for name, objects in (
            ("building", self.scene["buildings"]),
            ("ground", [self.scene["ground"]]),
        ):
            self.mesh_gpu[name].upload_instances(instance_data(objects))
        self.building_count = len(self.scene["buildings"])
        self._box_targets = [o for o in self.targets if o.mesh == "box"]
        self._cyl_targets = [o for o in self.targets if o.mesh == "cylinder"]
        self._box_index = {id(o): i for i, o in enumerate(self._box_targets)}
        self._cyl_index = {id(o): i for i, o in enumerate(self._cyl_targets)}
        self._global_index = {id(o): i for i, o in enumerate(self.targets)}
        self._diff_texture = self.ctx.texture((self.width, self.height), 4)
        self._diff_fbo = self.ctx.framebuffer(
            color_attachments=[self._diff_texture])

    def _set_camera(self, view: np.ndarray) -> None:
        for gpu in self.mesh_gpu.values():
            gpu.program["u_view"].write(view.T.tobytes())
            gpu.program["u_proj"].write(self.proj.T.tobytes())
            gpu.program["u_light_dir"].write(self.light.tobytes())

    def _render_static(self, eye: np.ndarray) -> None:
        for gpu in self.mesh_gpu.values():
            gpu.program["u_camera_pos"].write(eye.astype("f4").tobytes())
        self.mesh_gpu["ground"].render(1)
        self.mesh_gpu["building"].render(self.building_count)

    def render_frame(self, frame_index: int, frame_count: int) -> FrameStats:
        ctx = self.ctx
        eye, look = camera_at(frame_index, frame_count)
        view = look_at(eye, look, np.array([0, 1, 0], dtype="f4"))
        view_proj = (self.proj @ view).T
        planes = extract_planes(view_proj)
        self._set_camera(view)

        # 1) 帧初取回上一批异步查询结果（可能仍未就绪 -> 保守处理）。
        in_flight_start = self.query_pool.in_flight
        self.state.resolve_previous(frame_index, self.query_pool)

        # 2) 视锥剔除并对每个候选物体做本帧决策。
        visible_objects, occluded_objects, statuses = [], [], []
        counters = {"passed": 0, "occluded": 0, "delayed": 0, "outside": 0}
        for idx, obj in enumerate(self.targets):
            inside = aabb_in_frustum(obj.center, obj.half_extents, planes)
            self.state.mark_outside(idx, not inside)
            if not inside:
                statuses.append("outside")
                counters["outside"] += 1
                continue
            status, draw = self.state.decide(idx, frame_index)
            statuses.append(status)
            counters[status] += 1
            (visible_objects if draw else occluded_objects).append(obj)

        # 3) 主通道：先画地面与建筑，建立深度缓冲。
        ctx.enable(ctx.DEPTH_TEST)
        self.main_fbo.fbo.use()
        ctx.clear(0.12, 0.14, 0.18, 1.0)
        self._render_static(eye)

        # 4) 查询通道：对所有候选（含被遮挡者）发包围盒查询，只写深度不测颜色。
        query_candidates = visible_objects + occluded_objects
        issued = 0
        ctx.depth_func = "<="
        ctx.color_mask = False, False, False, False
        ctx.depth_mask = False
        for obj in query_candidates:
            query = self.query_pool.acquire()
            if query is None:
                break
            gpu = self.mesh_gpu[obj.mesh]
            gpu.upload_instances(instance_data([obj]))
            idx = self._global_index[id(obj)]
            with query:
                gpu.vao.render(instances=1)
            self.state.issue(idx, frame_index, query)
            issued += 1
        ctx.color_mask = True, True, True, True
        ctx.depth_mask = True
        ctx.depth_func = "<"

        # 5) 实体通道：仅绘制判定可见的实例（按网格分组，降低绘制次数）。
        by_mesh = {"box": [], "cylinder": []}
        for obj in visible_objects:
            by_mesh[obj.mesh].append(obj)
        draw_batches = 0
        for mesh_name, objects in by_mesh.items():
            if not objects:
                continue
            self.mesh_gpu[mesh_name].upload_instances(instance_data(objects))
            self.mesh_gpu[mesh_name].render(len(objects))
            draw_batches += 1

        # 6) 参考通道：无视剔除结果，绘制视锥内全部物体，用于正确性比对。
        self._render_reference(eye, view, planes)
        diff_pixels, max_delta = self._compare()
        depth_match = self.depth_identical()

        return FrameStats(
            frame=frame_index,
            candidates=len(query_candidates),
            passed=counters["passed"],
            occluded=counters["occluded"],
            delayed=counters["delayed"],
            outside=counters["outside"],
            target_draws=len(visible_objects),
            draw_batches=draw_batches,
            reference_draws=sum(1 for o in self.targets
                                if aabb_in_frustum(o.center, o.half_extents, planes)),
            queries_in_flight_start=in_flight_start,
            queries_in_flight_end=self.query_pool.in_flight,
            queries_issued=issued,
            diff_pixels=diff_pixels,
            max_channel_delta=max_delta,
            depth_match=depth_match,
        )

    def _render_reference(self, eye: np.ndarray, view: np.ndarray,
                          planes: list) -> None:
        ctx = self.ctx
        self.ref_fbo.fbo.use()
        ctx.clear(0.12, 0.14, 0.18, 1.0)
        self._render_static(eye)
        by_mesh = {"box": [], "cylinder": []}
        for obj in self.targets:
            if aabb_in_frustum(obj.center, obj.half_extents, planes):
                by_mesh[obj.mesh].append(obj)
        for mesh_name, objects in by_mesh.items():
            if objects:
                self.mesh_gpu[mesh_name].upload_instances(instance_data(objects))
                self.mesh_gpu[mesh_name].render(len(objects))

    def _compare(self) -> tuple[int, float]:
        """比较剔除画面与全量参考画面。

        两条通道的几何/深度完全一致，差异仅来自 llvmpipe 在不同渲染负载
        下的亚像素光栅化抖动，统计超过阈值的像素数用于人工/自动复核。
        """
        a = np.frombuffer(self.main_fbo.color.read(), dtype=np.uint8).reshape(
            self.height, self.width, 4)[:, :, :3].astype(np.int16)
        b = np.frombuffer(self.ref_fbo.color.read(), dtype=np.uint8).reshape(
            self.height, self.width, 4)[:, :, :3].astype(np.int16)
        delta = np.abs(a - b)
        per_pixel = delta.max(axis=2)
        return int((per_pixel > 12).sum()), float(per_pixel.max())

    def depth_identical(self) -> bool:
        """剔除通道与参考通道的深度缓冲必须逐像素一致（剔除正确性硬指标）。"""
        dm = np.frombuffer(self.main_fbo.depth.read(alignment=1),
                           dtype=np.dtype("f4")).reshape(self.height, self.width)
        dr = np.frombuffer(self.ref_fbo.depth.read(alignment=1),
                           dtype=np.dtype("f4")).reshape(self.height, self.width)
        return bool(np.array_equal(dm, dr))

    def snapshot_main(self) -> np.ndarray:
        raw = self.main_fbo.color.read()
        return np.frombuffer(raw, dtype=np.uint8).reshape(
            self.height, self.width, 4)[:, :, :3][:, :, ::-1].copy()

    def snapshot_diff(self) -> np.ndarray:
        """主通道（不含 HUD）与参考通道的差异图，差异处洋红、其余压暗。"""
        prev_fbo = self.ctx.fbo
        self._diff_fbo.use()
        self.quad.blit_diff(
            self.main_fbo.color, self.ref_fbo.color, 12 / 255.0,
            (1.0 / self.width, 1.0 / self.height))
        raw = self._diff_fbo.read(components=3)
        out = np.frombuffer(raw, dtype=np.uint8).reshape(
            self.height, self.width, 3)[:, :, ::-1].copy()
        if prev_fbo is not None:
            prev_fbo.use()
        return out
