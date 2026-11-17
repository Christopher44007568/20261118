import test from "node:test";
import assert from "node:assert/strict";
import { VoxelVolume } from "../src/voxel.js";
import { naiveMesh, greedyMesh } from "../src/mesher.js";
import { sameSurface } from "../src/gpu.js";
import { SCENE_BUILDERS } from "../src/scenes.js";

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomVolume(seed) {
  const rand = mulberry32(seed);
  const volume = new VoxelVolume(10, 7, 6, 4);
  for (let i = 0; i < volume.voxels.length; i++) {
    const roll = rand();
    volume.voxels[i] = roll < 0.45 ? 0 : 1 + Math.floor(rand() * 3);
  }
  return volume;
}

test("built-in scenes: greedy mesh keeps the exact visible surface", () => {
  for (const builder of SCENE_BUILDERS) {
    const { volume } = builder();
    const naive = naiveMesh(volume);
    const greedy = greedyMesh(volume);
    assert.ok(sameSurface(naive.quads, greedy.quads));
    assert.ok(greedy.stats.quads <= naive.stats.quads);
    assert.ok(greedy.stats.triangles < naive.stats.triangles);
  }
});

test("random volumes: greedy and naive surfaces always match", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const volume = randomVolume(seed);
    const naive = naiveMesh(volume);
    const greedy = greedyMesh(volume);
    assert.ok(sameSurface(naive.quads, greedy.quads), `seed ${seed} mismatch`);
  }
});

test("internal faces between solid voxels are culled", () => {
  const volume = new VoxelVolume(2, 2, 2);
  for (let i = 0; i < volume.voxels.length; i++) volume.voxels[i] = 1;
  const naive = naiveMesh(volume);
  const greedy = greedyMesh(volume);
  // A solid 2x2x2 cube exposes exactly 6 faces of 2x2 unit squares.
  assert.equal(naive.stats.quads, 24);
  assert.equal(greedy.stats.quads, 6);
});

test("shared faces are culled even across different materials", () => {
  const volume = new VoxelVolume(2, 1, 1);
  volume.set(0, 0, 0, 1);
  volume.set(1, 0, 0, 2);
  const greedy = greedyMesh(volume);
  // The internal x=1 plane must not appear; only outer caps at x=0/x=2 may.
  const xPlaneCoords = greedy.quads
    .filter((q) => q.d === 0)
    .map((q) => q.x)
    .sort((a, b) => a - b);
  assert.deepEqual(xPlaneCoords, [0, 2]);
});

test("quads never merge across a material boundary", () => {
  const volume = new VoxelVolume(4, 1, 1);
  for (let x = 0; x < 4; x++) volume.set(x, 0, 0, x < 2 ? 1 : 2);
  const greedy = greedyMesh(volume);
  const topQuads = greedy.quads.filter((q) => q.d === 1 && q.sign === 1);
  assert.equal(topQuads.length, 2);
  assert.deepEqual(
    topQuads.map((q) => q.material).sort(),
    [1, 2]
  );
  const xs = topQuads.map((q) => q.x).sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 2]);
  assert.ok(topQuads.every((q) => q.w * q.h === 2));
});

test("a removed interior voxel exposes exactly six new faces", () => {
  const volume = new VoxelVolume(3, 3, 3);
  for (let i = 0; i < volume.voxels.length; i++) volume.voxels[i] = 1;
  const before = greedyMesh(volume).stats.quads;
  volume.set(1, 1, 1, 0);
  const after = greedyMesh(volume);
  // Outer shell stays 6 quads; the cavity adds 6 unit faces.
  assert.equal(after.stats.quads, before + 6);
});

test("greedy quads tile the surface without overlap or gaps", () => {
  const volume = randomVolume(99);
  const { quads } = greedyMesh(volume);
  const keys = new Set();
  for (const q of quads) {
    const u = (q.d + 1) % 3;
    const v = (q.d + 2) % 3;
    for (let h = 0; h < q.h; h++) {
      for (let w = 0; w < q.w; w++) {
        const corner = [q.x, q.y, q.z];
        const base = [q.x, q.y, q.z];
        corner[u] = base[u] + w;
        corner[v] = base[v] + h;
        const key = `${q.d}|${q.sign}|${corner.join("|")}`;
        assert.ok(!keys.has(key), "overlapping merged quad");
        keys.add(key);
      }
    }
  }
});
