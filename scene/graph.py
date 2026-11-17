"""Scene tree with incremental transform propagation.

Each node caches its world matrix, its own world-space AABB and the
aggregate AABB of its subtree. Editing a node's local transform only
recomputes the caches of that subtree (plus the aggregate bounds of its
ancestors); every other node keeps its cached values.

Deleting a node detaches its subtree and frees the subtree's GPU buffers.
All edits are recorded as commands so `undo()` can restore the previous
state, re-uploading GPU resources when a deletion is undone.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator, List, Optional

from .gpu import GpuDevice, Mesh
from .math3d import AABB, Mat4


@dataclass
class UpdateStats:
    """Instrumentation for a single incremental update."""

    nodes_visited: int = 0
    matrix_computations: int = 0
    aabb_computations: int = 0
    gpu_upload_bytes: int = 0
    gpu_freed_bytes: int = 0

    def __iadd__(self, other: "UpdateStats") -> "UpdateStats":
        self.nodes_visited += other.nodes_visited
        self.matrix_computations += other.matrix_computations
        self.aabb_computations += other.aabb_computations
        self.gpu_upload_bytes += other.gpu_upload_bytes
        self.gpu_freed_bytes += other.gpu_freed_bytes
        return self

    def summary(self) -> str:
        return (
            f"nodes_visited={self.nodes_visited} "
            f"matrix_computations={self.matrix_computations} "
            f"aabb_computations={self.aabb_computations} "
            f"gpu_upload_bytes={self.gpu_upload_bytes} "
            f"gpu_freed_bytes={self.gpu_freed_bytes}"
        )


class Node:
    __slots__ = (
        "name", "local", "world", "mesh", "gpu_handle",
        "world_aabb", "subtree_aabb", "visible",
        "parent", "children", "graph",
    )

    def __init__(self, name: str, local: Mat4 | None = None,
                 mesh: Mesh | None = None, visible: bool = True):
        self.name = name
        self.local = local if local is not None else Mat4.identity()
        self.world = Mat4.identity()
        self.mesh = mesh
        self.gpu_handle: Optional[int] = None
        self.world_aabb = AABB.empty()
        self.subtree_aabb = AABB.empty()
        self.visible = visible
        self.parent: Optional[Node] = None
        self.children: List[Node] = []
        self.graph: Optional[SceneGraph] = None

    def add_child(self, child: "Node") -> "Node":
        child.parent = self
        self.children.append(child)
        if self.graph is not None:
            self.graph._attach(child)
        return child

    def iter_subtree(self) -> Iterator["Node"]:
        yield self
        for child in self.children:
            yield from child.iter_subtree()

    def mesh_local_aabb(self) -> AABB:
        assert self.mesh is not None
        return AABB.from_points(self.mesh.vertices)

    def __repr__(self) -> str:
        return f"Node({self.name!r})"


class Command:
    """Undoable edit recorded by the scene graph."""

    def undo(self, graph: "SceneGraph") -> UpdateStats:
        raise NotImplementedError


class MoveCommand(Command):
    def __init__(self, node: Node, old_local: Mat4):
        self.node = node
        self.old_local = old_local

    def undo(self, graph: "SceneGraph") -> UpdateStats:
        return graph._apply_local(self.node, self.old_local)


class VisibilityCommand(Command):
    def __init__(self, node: Node, old_visible: bool):
        self.node = node
        self.old_visible = old_visible

    def undo(self, graph: "SceneGraph") -> UpdateStats:
        self.node.visible = self.old_visible
        stats = UpdateStats(nodes_visited=1)
        graph.last_stats = stats
        return stats


class DeleteCommand(Command):
    def __init__(self, node: Node, parent: Node, index: int):
        self.node = node
        self.parent = parent
        self.index = index

    def undo(self, graph: "SceneGraph") -> UpdateStats:
        return graph._restore_subtree(self.node, self.parent, self.index)


class SceneGraph:
    def __init__(self, device: GpuDevice | None = None):
        self.device = device if device is not None else GpuDevice()
        self.root = Node("root")
        self.root.graph = self
        self.commands: List[Command] = []
        self.last_stats = UpdateStats()
        self._attach(self.root)

    # -- internal propagation -------------------------------------------

    def _attach(self, node: Node) -> None:
        """(Re)attach a subtree: upload meshes and refresh its caches."""
        stats = UpdateStats()
        for n in node.iter_subtree():
            n.graph = self
            if n.mesh is not None and not self.device.is_resident(n.gpu_handle):
                before = self.device.stats.upload_bytes
                n.gpu_handle = self.device.upload(n.mesh)
                stats.gpu_upload_bytes += self.device.stats.upload_bytes - before
        stats += self._propagate(node)
        self.last_stats = stats

    def _propagate(self, node: Node) -> UpdateStats:
        """Recompute world matrices for `node`'s subtree, then refresh the
        aggregate bounds along the ancestor chain. Sibling subtrees are
        never touched."""
        stats = UpdateStats()
        self._update_world_recursive(node, stats)
        self._update_ancestor_bounds(node.parent, stats)
        return stats

    def _update_world_recursive(self, node: Node, stats: UpdateStats) -> None:
        stats.nodes_visited += 1
        parent_world = node.parent.world if node.parent is not None else Mat4.identity()
        node.world = parent_world * node.local
        stats.matrix_computations += 1
        if node.mesh is not None:
            corners = node.mesh_local_aabb().corners()
            node.world_aabb = AABB.from_points(node.world.transform_point(c) for c in corners)
            stats.aabb_computations += 1
        aggregate = node.world_aabb
        for child in node.children:
            self._update_world_recursive(child, stats)
            aggregate = aggregate.union(child.subtree_aabb)
        node.subtree_aabb = aggregate

    def _update_ancestor_bounds(self, node: Optional[Node], stats: UpdateStats) -> None:
        """Only aggregate bounds change above the edited subtree; world
        matrices of ancestors are unaffected."""
        while node is not None:
            stats.nodes_visited += 1
            aggregate = node.world_aabb
            for child in node.children:
                aggregate = aggregate.union(child.subtree_aabb)
            node.subtree_aabb = aggregate
            node = node.parent

    # -- public edits ----------------------------------------------------

    def _apply_local(self, node: Node, new_local: Mat4) -> UpdateStats:
        node.local = new_local
        stats = self._propagate(node)
        self.last_stats = stats
        return stats

    def move(self, node: Node, new_local: Mat4) -> UpdateStats:
        self.commands.append(MoveCommand(node, node.local))
        return self._apply_local(node, new_local)

    def set_visible(self, node: Node, visible: bool) -> UpdateStats:
        self.commands.append(VisibilityCommand(node, node.visible))
        node.visible = visible
        stats = UpdateStats(nodes_visited=1)
        self.last_stats = stats
        return stats

    def delete(self, node: Node) -> UpdateStats:
        assert node.parent is not None, "cannot delete the root"
        parent = node.parent
        index = parent.children.index(node)
        self.commands.append(DeleteCommand(node, parent, index))
        parent.children.pop(index)
        node.parent = None
        stats = UpdateStats()
        for n in node.iter_subtree():
            stats.nodes_visited += 1
            if self.device.is_resident(n.gpu_handle):
                before = self.device.stats.freed_bytes
                self.device.free(n.gpu_handle)
                stats.gpu_freed_bytes += self.device.stats.freed_bytes - before
        # Ancestor aggregate bounds may shrink.
        self._update_ancestor_bounds(parent, stats)
        self.last_stats = stats
        return stats

    def _restore_subtree(self, node: Node, parent: Node, index: int) -> UpdateStats:
        parent.children.insert(index, node)
        node.parent = parent
        stats = UpdateStats()
        for n in node.iter_subtree():
            stats.nodes_visited += 1
            n.graph = self
            if n.mesh is not None and not self.device.is_resident(n.gpu_handle):
                before = self.device.stats.upload_bytes
                n.gpu_handle = self.device.upload(n.mesh)
                stats.gpu_upload_bytes += self.device.stats.upload_bytes - before
        stats += self._propagate(node)
        self.last_stats = stats
        return stats

    def undo(self) -> UpdateStats:
        assert self.commands, "nothing to undo"
        return self.commands.pop().undo(self)

    # -- validation helpers ----------------------------------------------

    def full_rebuild(self) -> UpdateStats:
        """Brute-force recompute of every cache from scratch."""
        stats = UpdateStats()
        self._update_world_recursive(self.root, stats)
        self.last_stats = stats
        return stats

    def snapshot(self) -> dict:
        """Comparable view of all computed caches, keyed by node name."""
        snap = {}
        for n in self.root.iter_subtree():
            snap[n.name] = (n.world, n.world_aabb, n.subtree_aabb, n.visible)
        return snap
