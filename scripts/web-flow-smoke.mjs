// Simulates the browser app's data pipeline without WebGL: every scene,
// every display mode and the dig/refresh cycle must produce uploadable
// buffers whose counts stay consistent.

import { naiveMesh, greedyMesh } from "../src/mesher.js";
import { buildGPUMesh, sameSurface } from "../src/gpu.js";
import { ChunkManager } from "../src/chunks.js";
import { buildWall, buildSingleHole, buildChecker } from "../src/scenes.js";

const builders = [buildWall, buildSingleHole, buildChecker];
let failures = 0;

for (const builder of builders) {
  const scene = builder();
  const naive = naiveMesh(scene.volume);
  const greedy = greedyMesh(scene.volume);
  const chunks = new ChunkManager(scene.volume);
  chunks.rebuildAll();

  for (const quads of [naive.quads, greedy.quads, chunks.allQuads()]) {
    const gpu = buildGPUMesh(quads);
    if (gpu.indexCount !== quads.length * 6) failures++;
    if (gpu.vertexCount !== quads.length * 4) failures++;
    if (gpu.indices.length * 4 > 2 ** 32) failures++;
  }
  if (!sameSurface(naive.quads, chunks.allQuads())) failures++;

  const [x, y, z] = scene.digTarget;
  const result = chunks.dig(x, y, z);
  if (result.rebuiltChunks.length >= chunks.meshes.size) failures++;
  if (!sameSurface(greedyMesh(scene.volume).quads, chunks.allQuads())) failures++;
  const postGpu = buildGPUMesh(chunks.allQuads());
  console.log(
    `${scene.name}: dig rebuilt ${result.rebuiltChunks.length}/${chunks.meshes.size} ` +
      `chunks, upload ${postGpu.vertexCount} verts / ${postGpu.indexCount} indices`
  );
}

if (failures > 0) {
  console.error(`smoke check failed: ${failures} assertion(s)`);
  process.exit(1);
}
console.log("web data-pipeline smoke check passed");
