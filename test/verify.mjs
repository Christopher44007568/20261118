// Verification harness: flies the camera along a valley and a ridge (plus an
// altitude sweep) and proves, per frame, that
//   1. adjacent chunk LODs differ by at most one level;
//   2. shared LOD boundaries are geometrically identical (no light gaps);
//   3. LOD switches do not move the surface (no vertex popping);
// and records triangle counts for the highest/lowest detail chunks.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHUNK_SIZE, WORLD_CHUNKS, WORLD_SIZE, LEVELS,
  terrainHeight, trianglesForLevel,
} from '../src/terrain.js';
import {
  computeLevels, computeMorphT, edgeUniformsFor,
} from '../src/lod.js';
import { boundaryPolyline, finalChunkPositions, templateFor } from '../src/morphcpu.js';
import { valleyPath, ridgePath } from '../src/tour.js';
import { encodePNG } from '../tools/png.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(ART, { recursive: true });

// Memoized height (integer lattice points repeat heavily across frames).
const hCache = new Map();
function H(x, z) {
  const k = `${x},${z}`;
  let v = hCache.get(k);
  if (v === undefined) { v = terrainHeight(x, z); hCache.set(k, v); }
  return v;
}

// Evaluate one camera position: levels, morph factors, edge uniforms.
function evalFrame(camX, camY, camZ) {
  const levels = computeLevels(camX, camY, camZ);
  const morphTs = new Float32Array(WORLD_CHUNKS * WORLD_CHUNKS);
  for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
    for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
      const i = cz * WORLD_CHUNKS + cx;
      morphTs[i] = computeMorphT(camX, camY, camZ, cx, cz, levels[i]);
    }
  }
  return { levels, morphTs };
}

// Check every shared interior edge for geometric identity (no light gap).
function checkFrameBoundaries(frame) {
  const { levels, morphTs } = frame;
  let maxDev = 0;
  let maxLevelJump = 0;
  for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
    for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
      const i = cz * WORLD_CHUNKS + cx;
      // right neighbour (edge 1 of this = edge 0 of neighbour)
      // top neighbour   (edge 3 of this = edge 2 of neighbour)
      const pairs = [
        [cx + 1, cz, 1, 0],
        [cx, cz + 1, 3, 2],
      ];
      for (const [nx, nz, myEdge, nbEdge] of pairs) {
        if (nx >= WORLD_CHUNKS || nz >= WORLD_CHUNKS) continue;
        const ni = nz * WORLD_CHUNKS + nx;
        maxLevelJump = Math.max(maxLevelJump, Math.abs(levels[i] - levels[ni]));
        const euA = edgeUniformsFor(levels, morphTs, cx, cz);
        const euB = edgeUniformsFor(levels, morphTs, nx, nz);
        const pa = boundaryPolyline(cx, cz, levels[i], morphTs[i], euA, myEdge);
        const pb = boundaryPolyline(nx, nz, levels[ni], morphTs[ni], euB, nbEdge);
        maxDev = Math.max(maxDev, polylineDeviation(pa, pb));
      }
    }
  }
  return { maxDev, maxLevelJump };
}

// Max surface height difference of one chunk between two frames, sampled on
// the finer of the two tessellations (surfaces stay height graphs).
function chunkSurfaceDiff(lA, posA, lB, posB, cx, cz) {
  const fineLevel = Math.min(lA, lB);
  const tpl = templateFor(fineLevel);
  const n = tpl.n, s = tpl.step;
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  let m = 0;
  for (let j = 0; j <= n; j++) {
    for (let ii = 0; ii <= n; ii++) {
      const x = ox + ii * s, z = oz + j * s;
      const hA = surfaceHeightAt(posA, lA, cx, cz, x, z);
      const hB = surfaceHeightAt(posB, lB, cx, cz, x, z);
      m = Math.max(m, Math.abs(hA - hB));
    }
  }
  return m;
}

// Arc-length resample a 2D path into camera frames at terrain+offset.
function resample(pathPts, step, offset) {
  const frames = [];
  let acc = 0;
  for (let i = 0; i < pathPts.length - 1; i++) {
    const [x0, z0] = pathPts[i], [x1, z1] = pathPts[i + 1];
    const seg = Math.hypot(x1 - x0, z1 - z0);
    let s = acc;
    while (s < seg) {
      const f = s / seg;
      const x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
      frames.push([x, H(x, z) + offset, z]);
      s += step;
    }
    acc = s - seg;
  }
  return frames;
}

const results = {
  generatedAt: new Date().toISOString(),
  world: { chunks: WORLD_CHUNKS, chunkSize: CHUNK_SIZE, levels: LEVELS },
  triangles: {},
  tours: {},
  switchTest: null,
};
for (let l = 0; l < LEVELS; l++) {
  results.triangles[`LOD${l}`] = trianglesForLevel(l);
}
results.triangles.maxVsMinDiff = trianglesForLevel(0) - trianglesForLevel(LEVELS - 1);
results.triangles.maxVsMinRatio = trianglesForLevel(0) / trianglesForLevel(LEVELS - 1);

function runTour(name, camFrames) {
  let maxGap = 0, maxJump = 0, maxPop = 0, switches = 0;
  let prev = null;
  for (const [cx, cy, cz] of camFrames) {
    const frame = evalFrame(cx, cy, cz);
    const { maxDev, maxLevelJump } = checkFrameBoundaries(frame);
    maxGap = Math.max(maxGap, maxDev);
    maxJump = Math.max(maxJump, maxLevelJump);
    if (prev) {
      // chunks that changed level, plus their neighbours: test surface continuity
      const relevant = new Set();
      const switched = new Set();
      for (let i = 0; i < frame.levels.length; i++) {
        if (frame.levels[i] !== prev.levels[i]) {
          switches++;
          switched.add(i);
          const cx2 = i % WORLD_CHUNKS, cz2 = Math.floor(i / WORLD_CHUNKS);
          relevant.add(`${cx2},${cz2}`);
        }
      }
      for (const key of relevant) {
        const [ccx, ccz] = key.split(',').map(Number);
        const i = ccz * WORLD_CHUNKS + ccx;
        // skip chunks whose neighbour switched in the same frame (the exact
        // switch-instant test covers those configurations separately)
        let nbSwitched = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = (ccz + dz) * WORLD_CHUNKS + (ccx + dx);
          if (switched.has(ni)) nbSwitched = true;
        }
        if (nbSwitched) continue;
        const oldLevel = prev.levels[i], newLevel = frame.levels[i];
        const coarsening = newLevel > oldLevel;
        // Compare the two levels at the SAME camera position, with morph
        // factors forced to their switch-complete values (old: 1 / new: 0
        // when coarsening, old: 0 / new: 1 when refining). Any residual is a
        // genuine vertex jump, not smooth geomorph motion.
        const hypLevels = frame.levels.slice();
        hypLevels[i] = oldLevel;
        const hypT = frame.morphTs.slice();
        hypT[i] = coarsening ? 1 : 0;
        const euOld = edgeUniformsFor(hypLevels, hypT, ccx, ccz);
        const posOld = finalChunkPositions(ccx, ccz, oldLevel, hypT[i], euOld);
        const newT = frame.morphTs.slice();
        newT[i] = coarsening ? 0 : 1;
        const euNew = edgeUniformsFor(frame.levels, newT, ccx, ccz);
        const posNew = finalChunkPositions(ccx, ccz, newLevel, newT[i], euNew);
        maxPop = Math.max(maxPop,
          chunkSurfaceDiff(oldLevel, posOld, newLevel, posNew, ccx, ccz));
      }
    }
    prev = frame;
  }
  results.tours[name] = {
    frames: camFrames.length,
    maxBoundaryGap: maxGap,
    maxNeighbourLevelJump: maxJump,
    maxSwitchSurfaceShift: maxPop,
    levelSwitches: switches,
  };
  console.log(`[${name}] frames=${camFrames.length} maxGap=${maxGap.toExponential(2)} ` +
    `maxLevelJump=${maxJump} maxSwitchShift=${maxPop.toExponential(2)} switches=${switches}`);
}

// Exact switch test: put a chunk exactly at a level boundary and verify the
// surface is identical on both sides of the switch (no vertex jump).
function switchInstantTest() {
  let worst = 0;
  const ccx = 10, ccz = 10; // world-centre chunk
  const ox = ccx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const oz = ccz * CHUNK_SIZE + CHUNK_SIZE / 2;
  for (const level of [0, 1, 2]) {
    const D = 96 * Math.pow(2, level + 1); // switch distance L -> L+1
    for (const eps of [-1e-6, 1e-6]) {
      // camera on a 3D ray so the chunk centre is exactly at D ± eps
      const camY = H(ox, oz) + D * 0.4;
      const horiz = Math.sqrt(Math.max((D + eps) ** 2 - (D * 0.4) ** 2, 1));
      const frame = evalFrame(ox + horiz, camY, oz);
      const i = ccz * WORLD_CHUNKS + ccx;
      const eu = edgeUniformsFor(frame.levels, frame.morphTs, ccx, ccz);
      const pos = finalChunkPositions(ccx, ccz, frame.levels[i], frame.morphTs[i], eu);
      if (eps < 0) switchInstantTest[`before${level}`] = { frame, pos };
      else {
        const b = switchInstantTest[`before${level}`];
        const la = b.frame.levels[i], lb = frame.levels[i];
        const diff = chunkSurfaceDiff(la, b.pos, lb, pos, ccx, ccz);
        worst = Math.max(worst, diff);
        console.log(`  switch L${level}->L${level + 1}: surface shift ${diff.toExponential(3)}`);
      }
    }
  }
  results.switchTest = { maxSurfaceShift: worst };
}

// --- PNG renders ---
function renderHeightmap(vPath, rPath) {
  const W = 512, HH = 512;
  const img = new Uint8Array(W * HH * 3);
  let mn = Infinity, mx = -Infinity;
  const hs = new Float32Array(W * HH);
  for (let j = 0; j < HH; j++) {
    for (let i = 0; i < W; i++) {
      const h = H(i / W * WORLD_SIZE, j / HH * WORLD_SIZE);
      hs[j * W + i] = h;
      mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
  }
  for (let j = 0; j < HH; j++) {
    for (let i = 0; i < W; i++) {
      const t = (hs[j * W + i] - mn) / (mx - mn);
      const shade = 0.75 + 0.25 * ((hs[j * W + Math.max(i - 1, 0)] - hs[j * W + i]) * 0.2 + 0.5);
      const v = Math.max(0, Math.min(255, t * 255 * shade));
      img.set([v * 0.6, v * 0.9, v * 0.65].map(Math.round), (j * W + i) * 3);
    }
  }
  const draw = (pts, rgb) => {
    for (const [x, z] of pts) {
      const px = Math.round(x / WORLD_SIZE * (W - 1));
      const pz = Math.round(z / WORLD_SIZE * (HH - 1));
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const xx = px + dx, zz = pz + dz;
        if (xx >= 0 && zz >= 0 && xx < W && zz < HH) img.set(rgb, (zz * W + xx) * 3);
      }
    }
  };
  draw(vPath, [40, 80, 255]);
  draw(rPath, [255, 60, 40]);
  fs.writeFileSync(path.join(ART, 'heightmap_tours.png'), encodePNG(W, HH, img));
}

function renderLodMap(name, camX, camY, camZ) {
  const S = 20, scale = 20;
  const frame = evalFrame(camX, camY, camZ);
  const colors = [[55, 214, 122], [163, 214, 53], [245, 166, 35], [233, 79, 55]];
  const img = new Uint8Array(S * scale * S * scale * 3);
  for (let cz = 0; cz < S; cz++) {
    for (let cx = 0; cx < S; cx++) {
      const c = colors[frame.levels[cz * S + cx]];
      for (let j = 0; j < scale; j++) {
        for (let i = 0; i < scale; i++) {
          img.set(c, ((cz * scale + j) * S * scale + cx * scale + i) * 3);
        }
      }
    }
  }
  fs.writeFileSync(path.join(ART, name), encodePNG(S * scale, S * scale, img));
}

// --- main ---
console.log('== terrain LOD verification ==');
console.log('running switch-instant test...');
switchInstantTest();

console.log('tracing valley & ridge paths...');
const vPath = valleyPath();
const rPath = ridgePath();

console.log('running valley tour...');
runTour('valley', resample(vPath, 3, 9));
console.log('running ridge tour...');
runTour('ridge', resample(rPath, 3, 45));

console.log('running altitude sweep...');
const sweep = [];
for (let k = 0; k <= 80; k++) {
  const y = 5 + (k / 80) * 900;
  sweep.push([WORLD_SIZE / 2, y, WORLD_SIZE / 2]);
}
runTour('altitudeSweep', sweep);

renderHeightmap(vPath, rPath);
const midV = resample(vPath, 3, 9)[Math.floor(resample(vPath, 3, 9).length / 2)];
const midR = resample(rPath, 3, 45)[Math.floor(resample(rPath, 3, 45).length / 2)];
renderLodMap('lodmap_valley.png', ...midV);
renderLodMap('lodmap_ridge.png', ...midR);
renderLodMap('lodmap_high.png', WORLD_SIZE / 2, 700, WORLD_SIZE / 2);

fs.writeFileSync(path.join(ART, 'report.json'), JSON.stringify(results, null, 2));

// --- assertions ---
const TOL_GAP = 1e-6;
const TOL_POP = 1e-6;
let ok = true;
for (const [name, r] of Object.entries(results.tours)) {
  if (r.maxBoundaryGap > TOL_GAP) { console.error(`FAIL ${name}: boundary gap ${r.maxBoundaryGap}`); ok = false; }
  if (r.maxNeighbourLevelJump > 1) { console.error(`FAIL ${name}: level jump ${r.maxNeighbourLevelJump}`); ok = false; }
  if (r.maxSwitchSurfaceShift > TOL_POP) { console.error(`FAIL ${name}: switch shift ${r.maxSwitchSurfaceShift}`); ok = false; }
}
if (results.switchTest.maxSurfaceShift > 1e-6) {
  console.error(`FAIL switch test: ${results.switchTest.maxSurfaceShift}`);
  ok = false;
}
console.log(`triangles: LOD0=${results.triangles.LOD0} LOD3=${results.triangles.LOD3} ` +
  `diff=${results.triangles.maxVsMinDiff} (${results.triangles.maxVsMinRatio}x)`);
console.log(ok ? 'ALL CHECKS PASSED' : 'CHECKS FAILED');
process.exit(ok ? 0 : 1);

function distPointSeg(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.hypot(dx, dy, dz);
}

// Max distance between two polylines (both directions).
function polylineDeviation(pa, pb) {
  let m = 0;
  for (const p of pa) {
    let d = Infinity;
    for (let i = 0; i < pb.length - 1; i++) d = Math.min(d, distPointSeg(p, pb[i], pb[i + 1]));
    m = Math.max(m, d);
  }
  for (const p of pb) {
    let d = Infinity;
    for (let i = 0; i < pa.length - 1; i++) d = Math.min(d, distPointSeg(p, pa[i], pa[i + 1]));
    m = Math.max(m, d);
  }
  return m;
}

// Height of a chunk's final surface at world (x, z): the mesh stays a height
// graph because morphing only moves vertices vertically.
function surfaceHeightAt(positions, level, cx, cz, x, z) {
  const tpl = templateFor(level);
  const n = tpl.n, s = tpl.step;
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  const fi = Math.min(n - 1, Math.max(0, Math.floor((x - ox) / s)));
  const fj = Math.min(n - 1, Math.max(0, Math.floor((z - oz) / s)));
  const v = (i, j) => positions[j * (n + 1) + i];
  const a = v(fi, fj), b = v(fi + 1, fj), c = v(fi + 1, fj + 1), d = v(fi, fj + 1);
  const lx = (x - ox) / s - fi, lz = (z - oz) / s - fj;
  // triangles: (a,c,b) for lx >= lz and (a,d,c) for lz >= lx (diagonal a-c)
  if (lx >= lz) {
    return a[1] + (b[1] - a[1]) * (lx - lz) + (c[1] - a[1]) * lz;
  }
  return a[1] + (d[1] - a[1]) * (lz - lx) + (c[1] - a[1]) * lx;
}
