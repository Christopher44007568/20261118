import test from "node:test";
import assert from "node:assert/strict";
import { VoxelVolume } from "../src/voxel.js";
import { greedyMesh } from "../src/mesher.js";
import { sameSurface } from "../src/gpu.js";
import { ChunkManager } from "../src/chunks.js";
import { SCENE_BUILDERS } from "../src/scenes.js";

test("affectedChunks covers own chunk and border neighbours only", () => {
  const volume = new VoxelVolume(16, 16, 16, 8);
  assert.deepEqual(volume.affectedChunks(4, 4, 4), [[0, 0, 0]]);
  const border = volume.affectedChunks(8, 4, 4);
  assert.equal(border.length, 2);
  assert.deepEqual(border, [[1, 0, 0], [0, 0, 0]]);
  const corner = volume.affectedChunks(8, 8, 8);
  assert.equal(corner.length, 4);
  // Non-cubic chunk counts: y/z bounds must be checked against their own axes.
  const flat = new VoxelVolume(16, 8, 8, 8);
  assert.deepEqual(flat.affectedChunks(4, 7, 4), [[0, 0, 0]]);
  assert.deepEqual(flat.affectedChunks(4, 4, 7), [[0, 0, 0]]);
});

test("dig rebuilds only the affected chunks", () => {
  for (const builder of SCENE_BUILDERS) {
    const { volume, digTarget } = builder();
    const chunks = new ChunkManager(volume);
    chunks.rebuildAll();
    const total = chunks.meshes.size;
    const snapshots = new Map(
      [...chunks.meshes].map(([key, mesh]) => [
        key,
        mesh.quads.map((quad) => ({ ...quad })),
      ])
    );

    const result = chunks.dig(...digTarget);
    assert.ok(result.rebuiltChunks.length < total);
    assert.equal(result.removedMaterial !== 0, true);
    assert.equal(volume.get(...digTarget), 0);

    const rebuiltKeys = new Set(result.rebuiltChunks.map((c) => chunks.key(...c)));
    for (const [key, mesh] of chunks.meshes) {
      if (!rebuiltKeys.has(key)) {
        assert.equal(
          JSON.stringify(mesh.quads),
          JSON.stringify(snapshots.get(key)),
          `untouched chunk ${key} changed`
        );
      }
    }

    const fullMesh = greedyMesh(volume);
    assert.ok(sameSurface(fullMesh.quads, chunks.allQuads()));
  }
});

test("dig on an empty voxel is a no-op and rebuilds nothing", () => {
  const { volume } = SCENE_BUILDERS[0]();
  const chunks = new ChunkManager(volume);
  chunks.rebuildAll();
  volume.set(0, 0, 0, 0);
  const before = chunks.triangleCount();
  const result = chunks.dig(0, 0, 0);
  assert.deepEqual(result.rebuiltChunks, []);
  assert.equal(result.trianglesBefore, before);
  assert.equal(result.delta, 0);
});

test("digging an interior voxel adds six faces worth of triangles", () => {
  const volume = new VoxelVolume(3, 3, 3, 8);
  for (let i = 0; i < volume.voxels.length; i++) volume.voxels[i] = 1;
  const chunks = new ChunkManager(volume);
  chunks.rebuildAll();
  const result = chunks.dig(1, 1, 1);
  assert.equal(result.delta, 12);
});

test("per-chunk meshes union into the whole-volume greedy mesh", () => {
  const { volume } = SCENE_BUILDERS[1]();
  const chunks = new ChunkManager(volume);
  chunks.rebuildAll();
  const full = greedyMesh(volume);
  assert.ok(sameSurface(full.quads, chunks.allQuads()));
});
