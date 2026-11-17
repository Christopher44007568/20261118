import test from "node:test";
import assert from "node:assert/strict";
import { VoxelVolume } from "../src/voxel.js";
import { greedyMesh } from "../src/mesher.js";
import { buildGPUMesh } from "../src/gpu.js";
import { SCENE_BUILDERS } from "../src/scenes.js";

function readVertex(mesh, vertexIndex) {
  const stride = mesh.strideFloats;
  const base = vertexIndex * stride;
  const data = mesh.vertices;
  return {
    position: [data[base], data[base + 1], data[base + 2]],
    normal: [data[base + 3], data[base + 4], data[base + 5]],
    color: [data[base + 6], data[base + 7], data[base + 8]],
  };
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

test("buffers use Uint32 indices and an interleaved 9-float stride", () => {
  const { volume } = SCENE_BUILDERS[0]();
  const mesh = buildGPUMesh(greedyMesh(volume).quads);
  assert.ok(mesh.vertices instanceof Float32Array);
  assert.ok(mesh.indices instanceof Uint32Array);
  assert.equal(mesh.strideFloats, 9);
  assert.equal(mesh.indices.length, mesh.indexCount);
  assert.equal(mesh.vertices.length, mesh.vertexCount * 9);
  assert.equal(mesh.indexCount % 6, 0);
});

test("every triangle winds consistently outward with its normal", () => {
  for (const builder of SCENE_BUILDERS) {
    const { volume } = builder();
    const mesh = buildGPUMesh(greedyMesh(volume).quads);
    for (let face = 0; face < mesh.indexCount; face += 6) {
      for (let tri = 0; tri < 2; tri++) {
        const ids = tri === 0
          ? [mesh.indices[face], mesh.indices[face + 1], mesh.indices[face + 2]]
          : [mesh.indices[face + 3], mesh.indices[face + 4], mesh.indices[face + 5]];
        const p0 = readVertex(mesh, ids[0]).position;
        const p1 = readVertex(mesh, ids[1]).position;
        const p2 = readVertex(mesh, ids[2]).position;
        const geometric = cross(sub(p1, p0), sub(p2, p0));
        const stored = readVertex(mesh, ids[0]).normal;
        assert.ok(dot(geometric, stored) > 0, `inward winding in ${builder.name}`);
      }
    }
  }
});

test("all four vertices of a quad share the same normal and material color", () => {
  const volume = new VoxelVolume(2, 2, 2);
  volume.set(0, 0, 0, 1);
  volume.set(1, 1, 1, 2);
  const mesh = buildGPUMesh(greedyMesh(volume).quads);
  for (let face = 0; face < mesh.vertexCount; face += 4) {
    const normal = readVertex(mesh, face).normal;
    const color = readVertex(mesh, face).color;
    for (let k = 1; k < 4; k++) {
      assert.deepEqual(readVertex(mesh, face + k).normal, normal);
      assert.deepEqual(readVertex(mesh, face + k).color, color);
    }
  }
});

test("indices reference only valid vertices", () => {
  const { volume } = SCENE_BUILDERS[2]();
  const mesh = buildGPUMesh(greedyMesh(volume).quads);
  for (const id of mesh.indices) {
    assert.ok(id >= 0 && id < mesh.vertexCount);
  }
});
