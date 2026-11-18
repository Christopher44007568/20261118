"""moderngl 资源封装：网格 VAO、实例缓冲、遮挡查询池与离屏帧缓冲。"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .shaders import MESH_VS, MESH_FS, QUAD_VS, QUAD_FS, DIFF_FS

# 每实例 19 个 float：mat4(16) + color(3)
INSTANCE_FLOATS = 19


class MeshGpu:
    def __init__(self, ctx, name: str, vertices: np.ndarray, indices: np.ndarray):
        self.name = name
        self.vbo = ctx.buffer(vertices.astype("f4").tobytes())
        self.ibo = ctx.buffer(indices.astype("i4").tobytes())
        self.instance_buffer = ctx.buffer(reserve=1)
        self.index_count = indices.size
        self.vao = ctx.vertex_array(
            ctx.program(vertex_shader=MESH_VS, fragment_shader=MESH_FS),
            [
                (self.vbo, "3f 3f", 0, 1),
                (self.instance_buffer, "16f 3f /i", 2, 6),
            ],
            self.ibo,
        )
        self.program = self.vao.program

    def upload_instances(self, data: np.ndarray) -> None:
        raw = data.astype("f4").tobytes()
        if len(raw) != self.instance_buffer.size:
            self.instance_buffer.orphan(size=max(len(raw), 1))
        self.instance_buffer.write(raw)

    def render(self, instance_count: int) -> None:
        if instance_count > 0:
            self.vao.render(instances=instance_count)


@dataclass
class FrameBuffers:
    color: object
    depth: object
    fbo: object


def make_frame_buffers(ctx, width: int, height: int) -> FrameBuffers:
    color = ctx.texture((width, height), 4)
    depth = ctx.depth_texture((width, height))
    fbo = ctx.framebuffer(color_attachments=[color], depth_attachment=depth)
    return FrameBuffers(color, depth, fbo)


class FullScreenQuad:
    def __init__(self, ctx):
        verts = np.array([
            -1, -1, 0, 0,
             1, -1, 1, 0,
            -1,  1, 0, 1,
             1,  1, 1, 1,
        ], dtype="f4")
        self.vbo = ctx.buffer(verts.tobytes())
        self.texture_prog = ctx.program(vertex_shader=QUAD_VS, fragment_shader=QUAD_FS)
        self.diff_prog = ctx.program(vertex_shader=QUAD_VS, fragment_shader=DIFF_FS)
        self.vao = ctx.vertex_array(
            self.texture_prog, [(self.vbo, "2f 2f", 0, 1)])
        self.diff_vao = ctx.vertex_array(
            self.diff_prog, [(self.vbo, "2f 2f", 0, 1)])

    def blit_texture(self, texture, alpha: float = 1.0) -> None:
        texture.use(0)
        self.texture_prog["u_tex"].value = 0
        self.texture_prog["u_alpha"].value = alpha
        self.vao.render()

    def blit_diff(self, tex_a, tex_b, threshold: float, texel: tuple[float, float]) -> None:
        tex_a.use(0)
        tex_b.use(1)
        self.diff_prog["u_tex_a"].value = 0
        self.diff_prog["u_tex_b"].value = 1
        self.diff_prog["u_threshold"].value = threshold
        self.diff_prog["u_texel"].value = texel
        self.diff_vao.render()


def instance_data(objects) -> np.ndarray:
    """把 Object 列表打包为实例缓冲数据。"""
    out = np.empty((len(objects), INSTANCE_FLOATS), dtype="f4")
    for row, obj in zip(out, objects):
        # GLSL mat4 按列主序读取，numpy 为行主序，需要转置。
        row[:16] = obj.model.T.reshape(16)
        row[16:19] = obj.color
    return out
