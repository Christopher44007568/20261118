// Node CLI: prints face-count reduction and local-rebuild stats for
// every built-in scene. Run with: node scripts/benchmark.mjs

import { naiveMesh, greedyMesh } from "../src/mesher.js";
import { sameSurface, buildGPUMesh } from "../src/gpu.js";
import { SCENE_BUILDERS } from "../src/scenes.js";
import { ChunkManager } from "../src/chunks.js";

for (const builder of SCENE_BUILDERS) {
  const { name, volume, digTarget } = builder();
  const naive = naiveMesh(volume);
  const greedy = greedyMesh(volume);
  const gpu = buildGPUMesh(greedy.quads);
  const reduction = ((1 - greedy.stats.quads / naive.stats.quads) * 100).toFixed(1);
  console.log(name);
  console.log(
    `  naive faces: ${naive.stats.quads}  greedy quads: ${greedy.stats.quads}  ` +
      `triangles: ${naive.stats.triangles} -> ${greedy.stats.triangles} (${reduction}% fewer)`
  );
  console.log(
    `  surface identical after merge: ${sameSurface(naive.quads, greedy.quads)}  ` +
      `GPU indices: ${gpu.indexCount} (Uint32)`
  );

  const chunks = new ChunkManager(volume);
  chunks.rebuildAll();
  const totalChunks = chunks.meshes.size;
  const result = chunks.dig(...digTarget);
  console.log(
    `  dig ${JSON.stringify(digTarget)}: rebuilt ${result.rebuiltChunks.length}/${totalChunks} ` +
      `chunks, triangles ${result.trianglesBefore} -> ${result.trianglesAfter} ` +
      `(delta ${result.delta})`
  );
  const whole = greedyMesh(volume);
  console.log(
    `  chunk union matches whole-volume greedy after edit: ${sameSurface(
      whole.quads,
      chunks.allQuads()
    )}`
  );
  console.log("");
}
