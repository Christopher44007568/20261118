// Headless verification: for every frame of every camera path, the octree
// visible set must equal the brute-force per-object visible set.
import { Frustum, bruteForceVisible } from './octree.js';
import { buildScene, buildCameraPaths, updateDynamics } from './scene.js';

function ids(objects) {
  return objects.map((o) => o.id).sort((a, b) => a - b);
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let totalFrames = 0;
let failures = 0;

for (const path of buildCameraPaths()) {
  const scene = buildScene();
  const totals = { nodesVisited: 0, nodesPruned: 0, nodesSkippedInside: 0, accepted: 0, rejected: 0 };
  let pathFailures = 0;

  path.frames.forEach((params, frameIndex) => {
    const t = frameIndex * 0.1;
    updateDynamics(scene, t);
    const frustum = new Frustum(params);

    const { visible, stats } = scene.tree.cull(frustum);
    const allObjects = [...scene.statics, ...scene.dynamics];
    const expected = bruteForceVisible(frustum, allObjects);

    totalFrames++;
    if (!sameSet(ids(visible), ids(expected))) {
      failures++;
      pathFailures++;
      console.error(
        `MISMATCH ${path.name} frame ${frameIndex}: ` +
        `octree=${visible.length} brute=${expected.length}`
      );
    }

    totals.nodesVisited += stats.nodesVisited;
    totals.nodesPruned += stats.nodesPruned;
    totals.nodesSkippedInside += stats.nodesSkippedInside;
    totals.accepted += stats.objectsAccepted;
    totals.rejected += stats.objectsRejected;
  });

  const n = path.frames.length;
  console.log(
    `${path.label}\n` +
    `  frames=${n} mismatches=${pathFailures}\n` +
    `  avg nodes visited=${(totals.nodesVisited / n).toFixed(1)} ` +
    `pruned=${(totals.nodesPruned / n).toFixed(1)} ` +
    `skipped(inside)=${(totals.nodesSkippedInside / n).toFixed(1)}\n` +
    `  avg objects accepted=${(totals.accepted / n).toFixed(1)} ` +
    `rejected=${(totals.rejected / n).toFixed(1)}`
  );
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${totalFrames} frames, ${failures} mismatches`);
process.exit(failures === 0 ? 0 : 1);
