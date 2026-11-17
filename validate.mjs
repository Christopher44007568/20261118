// Headless validation of the skinning pipeline (mirrors the GPU math on CPU).
// Checks: weight normalization, hierarchy propagation, joint stability during
// crossfades, feet above ground. Exports per-frame bone matrices + AABBs.
import { writeFileSync, mkdirSync } from 'node:fs';
import { Mat4 } from './src/math.js';
import {
  BONES, BONE_COUNT, BIND_LOCAL, BIND_LENGTHS,
  computeWorldMatrices, computeBoneMatrices, flattenMatrices, boneIndex,
} from './src/rig.js';
import { buildMesh, skinCPU, computeAABB } from './src/mesh.js';
import { Crossfader } from './src/anim.js';

const DT = 1 / 60;
const FOOT_TOL = -0.01;
const LEN_TOL = 1e-4;
const HIER_TOL = 1e-6;

const mesh = buildMesh();
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

// --- 1. Weights normalized ---
let maxWErr = 0;
for (let vIdx = 0; vIdx < mesh.vertexCount; vIdx++) {
  const s = mesh.weights[vIdx * 4] + mesh.weights[vIdx * 4 + 1]
          + mesh.weights[vIdx * 4 + 2] + mesh.weights[vIdx * 4 + 3];
  maxWErr = Math.max(maxWErr, Math.abs(1 - s));
}
check(maxWErr < 1e-5, `weights not normalized (max err ${maxWErr})`);

// Foot vertex sets (for ground-penetration check).
const footIdx = [boneIndex('footL'), boneIndex('footR')];
const footVerts = [];
for (let vIdx = 0; vIdx < mesh.vertexCount; vIdx++) {
  for (let k = 0; k < 4; k++) {
    if (footIdx.includes(mesh.joints[vIdx * 4 + k]) && mesh.weights[vIdx * 4 + k] > 0.3) {
      footVerts.push(vIdx);
      break;
    }
  }
}

// --- 2. Simulate: run -> wave -> run with crossfades ---
const fader = new Crossfader(0.4);
const script = [
  { t: 1.0, action: null },
  { t: 0.0, action: () => fader.play('wave') },
  { t: 1.6, action: null },
  { t: 0.0, action: () => fader.play('run') },
  { t: 1.0, action: null },
];

const frames = [];
let minFootY = Infinity;
let maxLenErr = 0;
let maxHierErr = 0;
let simTime = 0;
let frameNo = 0;

for (const step of script) {
  if (step.action) { step.action(); continue; }
  const n = Math.round(step.t / DT);
  for (let i = 0; i < n; i++) {
    const pose = fader.update(DT);
    simTime += DT;
    const world = computeWorldMatrices(pose);
    const boneMats = computeBoneMatrices(world);

    // Hierarchy: world[c] == world[p] * local(c)
    for (let b = 1; b < BONE_COUNT; b++) {
      const local = Mat4.fromRotationTranslation(pose.rot[b], BIND_LOCAL[b].pos);
      const expect = Mat4.multiply(world[BONES[b].parent], local);
      for (let e = 0; e < 16; e++) {
        maxHierErr = Math.max(maxHierErr, Math.abs(world[b][e] - expect[e]));
      }
      // Bone length preserved (no joint collapse/stretch during blending)
      const wp = Mat4.translation(world[BONES[b].parent]);
      const wc = Mat4.translation(world[b]);
      const len = Math.hypot(wc[0] - wp[0], wc[1] - wp[1], wc[2] - wp[2]);
      maxLenErr = Math.max(maxLenErr, Math.abs(len - BIND_LENGTHS[b]));
    }

    const skinned = skinCPU(mesh, boneMats);
    for (const vi of footVerts) minFootY = Math.min(minFootY, skinned[vi * 3 + 1]);

    frames.push({
      frame: frameNo++,
      time: +simTime.toFixed(4),
      clip: fader.target,
      blending: fader.blending,
      boneMatrices: Array.from(flattenMatrices(boneMats), (x) => +x.toFixed(6)),
      aabb: computeAABB(skinned),
    });
  }
}

check(maxHierErr < HIER_TOL, `hierarchy propagation error ${maxHierErr}`);
check(maxLenErr < LEN_TOL, `joint collapse/stretch, bone length err ${maxLenErr}`);
check(minFootY >= FOOT_TOL, `foot below ground: min y = ${minFootY}`);

mkdirSync(new URL('./artifacts', import.meta.url).pathname, { recursive: true });
const out = new URL('./artifacts/frames.json', import.meta.url).pathname;
writeFileSync(out, JSON.stringify({
  boneCount: BONE_COUNT,
  boneNames: BONES.map((b) => b.name),
  frameCount: frames.length,
  frames,
}));

console.log(`mesh: ${mesh.vertexCount} vertices, ${mesh.indices.length / 3} triangles`);
console.log(`frames simulated: ${frames.length} -> ${out}`);
console.log(`weight normalization max err : ${maxWErr.toExponential(2)}`);
console.log(`hierarchy propagation max err: ${maxHierErr.toExponential(2)}`);
console.log(`bone length max err (blend)  : ${maxLenErr.toExponential(2)}`);
console.log(`min foot vertex y            : ${minFootY.toFixed(4)}`);

if (failures.length) {
  console.error('\nFAILED:');
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log('\nAll checks passed.');
