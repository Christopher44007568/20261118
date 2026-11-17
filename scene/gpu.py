"""Simulated GPU resource manager.

Tracks buffer uploads/frees so the scene graph can report how many bytes
would be transferred to a real GPU, and so tests can assert that deleted
subtrees actually release their device resources.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List


@dataclass
class Mesh:
    """CPU-side geometry: positions plus triangle indices."""

    name: str
    vertices: List[tuple]
    triangles: List[tuple]

    @property
    def byte_size(self) -> int:
        # 3 floats per vertex, 3 uint32 per triangle.
        return len(self.vertices) * 3 * 4 + len(self.triangles) * 3 * 4


@dataclass
class GpuStats:
    uploads: int = 0
    frees: int = 0
    upload_bytes: int = 0
    freed_bytes: int = 0

    def reset(self) -> None:
        self.uploads = 0
        self.frees = 0
        self.upload_bytes = 0
        self.freed_bytes = 0


class GpuDevice:
    """Fake device: owns live buffers keyed by handle id."""

    def __init__(self) -> None:
        self._next_handle = 1
        self.buffers: Dict[int, int] = {}  # handle -> byte size
        self.stats = GpuStats()
        self.log: List[str] = []

    def upload(self, mesh: Mesh) -> int:
        handle = self._next_handle
        self._next_handle += 1
        self.buffers[handle] = mesh.byte_size
        self.stats.uploads += 1
        self.stats.upload_bytes += mesh.byte_size
        self.log.append(f"upload {mesh.name}: {mesh.byte_size}B -> handle {handle}")
        return handle

    def free(self, handle: int) -> None:
        size = self.buffers.pop(handle)
        self.stats.frees += 1
        self.stats.freed_bytes += size
        self.log.append(f"free handle {handle}: {size}B")

    @property
    def resident_bytes(self) -> int:
        return sum(self.buffers.values())

    def is_resident(self, handle: int | None) -> bool:
        return handle is not None and handle in self.buffers
