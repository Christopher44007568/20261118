"""Simulated GPU resources and render context.

The simulator models the state a real renderer would manage: resident
textures and shader programs with reference counts, a global VRAM budget,
and a render context holding the currently bound program, texture slots and
uniform block.  It lets tests prove that switching variants rebinds exactly
the required resources and that nothing leaks after a material is deleted.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .features import ShaderFeature, TextureSlot

# --- VRAM estimation constants (bytes) ------------------------------------
TEXEL_SIZE = 4          # RGBA8
TEXTURE_ALIGNMENT = 4096
SHADER_PROGRAM_BYTES = 16 * 1024
UNIFORM_BLOCK_BYTES = 4 * 1024


def _align(value: int, alignment: int) -> int:
    return (value + alignment - 1) // alignment * alignment


@dataclass(frozen=True)
class Texture:
    """A GPU texture allocation request."""

    name: str
    width: int
    height: int

    @property
    def size_bytes(self) -> int:
        return _align(self.width * self.height * TEXEL_SIZE, TEXTURE_ALIGNMENT)


@dataclass(frozen=True)
class ShaderProgram:
    """A compiled program keyed by its shader feature set."""

    key: frozenset[ShaderFeature]
    size_bytes: int = SHADER_PROGRAM_BYTES

    @property
    def keywords(self) -> tuple[ShaderFeature, ...]:
        return tuple(sorted(self.key, key=lambda feature: feature.value))


class GPUDevice:
    """Owns resident GPU resources and tracks VRAM usage."""

    def __init__(self, vram_budget_bytes: int | None = None) -> None:
        self._textures: dict[str, tuple[Texture, int]] = {}
        self._programs: dict[frozenset[ShaderFeature], tuple[ShaderProgram, int]] = {}
        self._buffers: dict[object, tuple[int, int]] = {}
        self.vram_budget_bytes = vram_budget_bytes

    # -- textures -----------------------------------------------------------
    def create_texture(self, name: str, width: int, height: int) -> Texture:
        existing = self._textures.get(name)
        if existing is not None:
            texture, refcount = existing
            self._textures[name] = (texture, refcount + 1)
            return texture
        texture = Texture(name, width, height)
        self._check_budget(texture.size_bytes)
        self._textures[name] = (texture, 1)
        return texture

    def release_texture(self, name: str) -> None:
        texture, refcount = self._textures[name]
        if refcount == 1:
            del self._textures[name]
        else:
            self._textures[name] = (texture, refcount - 1)

    # -- programs -----------------------------------------------------------
    def create_program(self, features: frozenset[ShaderFeature]) -> ShaderProgram:
        existing = self._programs.get(features)
        if existing is not None:
            program, refcount = existing
            self._programs[features] = (program, refcount + 1)
            return program
        program = ShaderProgram(features)
        self._check_budget(program.size_bytes)
        self._programs[features] = (program, 1)
        return program

    def release_program(self, features: frozenset[ShaderFeature]) -> None:
        program, refcount = self._programs[features]
        if refcount == 1:
            del self._programs[features]
        else:
            self._programs[features] = (program, refcount - 1)

    # -- uniform / generic buffers -----------------------------------------
    def acquire_buffer(self, key: object, size_bytes: int) -> None:
        existing = self._buffers.get(key)
        if existing is not None:
            size, refcount = existing
            self._buffers[key] = (size, refcount + 1)
            return
        self._check_budget(size_bytes)
        self._buffers[key] = (size_bytes, 1)

    def release_buffer(self, key: object) -> None:
        size, refcount = self._buffers[key]
        if refcount == 1:
            del self._buffers[key]
        else:
            self._buffers[key] = (size, refcount - 1)

    # -- introspection ------------------------------------------------------
    @property
    def used_vram_bytes(self) -> int:
        return sum(texture.size_bytes for texture, _ in self._textures.values()) + sum(
            program.size_bytes for program, _ in self._programs.values()
        ) + sum(size for size, _ in self._buffers.values())

    @property
    def resident_texture_names(self) -> tuple[str, ...]:
        return tuple(sorted(self._textures))

    @property
    def resident_program_keys(self) -> tuple[frozenset[ShaderFeature], ...]:
        return tuple(self._programs)

    def texture_refcount(self, name: str) -> int:
        return self._textures.get(name, (None, 0))[1]

    def program_refcount(self, features: frozenset[ShaderFeature]) -> int:
        return self._programs.get(features, (None, 0))[1]

    @property
    def is_empty(self) -> bool:
        return not self._textures and not self._programs and not self._buffers

    def _check_budget(self, allocation: int) -> None:
        if self.vram_budget_bytes is None:
            return
        if self.used_vram_bytes + allocation > self.vram_budget_bytes:
            raise MemoryError(
                f"VRAM budget exceeded: "
                f"{self.used_vram_bytes + allocation} > {self.vram_budget_bytes}"
            )


@dataclass
class RenderContext:
    """Mutable per-frame GPU state.

    Records the last bound program, per-slot texture bindings and the current
    uniform block so tests can assert that variant switches fully synchronize
    the context rather than leaving stale state behind.
    """

    device: GPUDevice
    bound_program: ShaderProgram | None = None
    texture_bindings: dict[TextureSlot, str] = field(default_factory=dict)
    uniforms: dict[str, object] = field(default_factory=dict)
    apply_log: list[str] = field(default_factory=list)

    def bind_program(self, program: ShaderProgram) -> None:
        if self.bound_program != program:
            self.bound_program = program
            # A program change invalidates every slot-level and uniform state.
            self.texture_bindings.clear()
            self.uniforms.clear()
            self.apply_log.append(f"program:{sorted(f.value for f in program.key)}")

    def bind_texture(self, slot: TextureSlot, texture_name: str) -> None:
        if self.texture_bindings.get(slot) != texture_name:
            self.texture_bindings[slot] = texture_name
            self.apply_log.append(f"tex:{slot.value}={texture_name}")

    def set_uniform(self, name: str, value: object) -> None:
        if self.uniforms.get(name) != value:
            self.uniforms[name] = value
            self.apply_log.append(f"uniform:{name}")

    def assert_slots_match(self, slots: frozenset[TextureSlot]) -> bool:
        return frozenset(self.texture_bindings) == slots

    def snapshot(self) -> dict[str, object]:
        return {
            "program": None
            if self.bound_program is None
            else tuple(feature.value for feature in self.bound_program.keywords),
            "textures": dict(self.texture_bindings),
            "uniforms": dict(self.uniforms),
        }
