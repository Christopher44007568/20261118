"""原生 GL_SAMPLES_PASSED 查询封装。

moderngl 的 Query 封装没有“结果是否就绪”接口，在 llvmpipe 上结果
 未就绪时读取会直接得到 0，会被误判为遮挡。这里直接通过 PyOpenGL
 使用 GL_SAMPLES_PASSED + GL_QUERY_RESULT_AVAILABLE，显式处理异步延迟。
"""

from __future__ import annotations

import numpy as np
import OpenGL.GL as gl


class RawQuery:
    def __init__(self):
        self.gl_id = int(gl.glGenQueries(1)[0])
        self.active = False

    def begin(self) -> None:
        gl.glBeginQuery(gl.GL_SAMPLES_PASSED, self.gl_id)
        self.active = True

    def end(self) -> None:
        gl.glEndQuery(gl.GL_SAMPLES_PASSED)
        self.active = False

    @property
    def ready(self) -> bool:
        return bool(gl.glGetQueryObjectiv(
            self.gl_id, gl.GL_QUERY_RESULT_AVAILABLE))

    @property
    def samples(self) -> int:
        return int(gl.glGetQueryObjectuiv(self.gl_id, gl.GL_QUERY_RESULT))

    def release(self) -> None:
        gl.glDeleteQueries(1, np.array([self.gl_id], dtype=np.uint32))

    def __enter__(self):
        self.begin()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.end()


class RawQueryPool:
    def __init__(self, capacity: int):
        self._queries = [RawQuery() for _ in range(capacity)]
        self._free = list(self._queries)

    def acquire(self):
        if not self._free:
            return None
        return self._free.pop()

    def release(self, query: RawQuery) -> None:
        self._free.append(query)

    @property
    def in_flight(self) -> int:
        return len(self._queries) - len(self._free)
