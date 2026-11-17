// CPU mirror of the vertex-shader morphing math (src/glsl.js TERRAIN_VERT).
// The verification harness uses this to recompute final vertex positions and
// prove that neighbouring chunks produce identical boundary polylines.

import { CHUNK_SIZE, terrainHeight } from './terrain.js';
import { MODE_FOLLOW, buildLevelTemplate } from './lod.js';

function lerp3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// Per-chunk evaluator mirroring the GLSL helper functions.
export function makeEvaluator(ox, oz, step, edge) {
  const surf = (lx, lz) => [ox + lx, terrainHeight(ox + lx, oz + lz), oz + lz];
  const onBoundary = (lx, lz) =>
    lx < 0.5 || lx > CHUNK_SIZE - 0.5 || lz < 0.5 || lz > CHUNK_SIZE - 0.5;
  const snapL1 = (lx, lz, dx, dz, coord) => {
    const parity = ((coord / step) % 2 + 2) % 2;
    if (parity < 0.5) return surf(lx, lz);
    const a = surf(lx - dx * step, lz - dz * step);
    const b = surf(lx + dx * step, lz + dz * step);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  };
  const snapL2 = (lx, lz, dx, dz, coord) => {
    const span = 4 * step;
    const lo = Math.floor(coord / span) * span;
    const hi = Math.min(lo + span, CHUNK_SIZE);
    const w = hi > lo ? (coord - lo) / (hi - lo) : 0;
    return lerp3(
      surf(lx - dx * (coord - lo), lz - dz * (coord - lo)),
      surf(lx + dx * (hi - coord), lz + dz * (hi - coord)), w);
  };
  const boundaryPos = (lx, lz) => {
    let dx, dz, coord, e;
    if (lx < 0.5) { dx = 0; dz = 1; coord = lz; e = 0; }
    else if (lx > CHUNK_SIZE - 0.5) { dx = 0; dz = 1; coord = lz; e = 1; }
    else if (lz < 0.5) { dx = 1; dz = 0; coord = lx; e = 2; }
    else { dx = 1; dz = 0; coord = lx; e = 3; }
    const et = edge.t[e];
    const s1 = snapL1(lx, lz, dx, dz, coord);
    if (edge.mode[e] === MODE_FOLLOW) {
      return lerp3(s1, snapL2(lx, lz, dx, dz, coord), et);
    }
    return lerp3(surf(lx, lz), s1, et);
  };
  const livePos = (lx, lz) => (onBoundary(lx, lz) ? boundaryPos(lx, lz) : surf(lx, lz));
  return { surf, onBoundary, boundaryPos, livePos };
}

// Final world position of one template vertex.
export function finalVertexPosition(tpl, vi, ox, oz, t, edge) {
  const ev = makeEvaluator(ox, oz, tpl.step, edge);
  const lx = tpl.pos[vi * 2], lz = tpl.pos[vi * 2 + 1];
  if (ev.onBoundary(lx, lz)) return ev.boundaryPos(lx, lz);
  const p = ev.surf(lx, lz);
  const a = ev.livePos(tpl.morphA[vi * 2], tpl.morphA[vi * 2 + 1]);
  const b = ev.livePos(tpl.morphB[vi * 2], tpl.morphB[vi * 2 + 1]);
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return lerp3(p, m, t);
}

const templates = new Map();
export function templateFor(level) {
  if (!templates.has(level)) templates.set(level, buildLevelTemplate(level));
  return templates.get(level);
}

// Ordered boundary polyline of one chunk edge as final world positions.
// edge: 0 left, 1 right, 2 bottom, 3 top.
export function boundaryPolyline(cx, cz, level, t, edgeUniforms, edge) {
  const tpl = templateFor(level);
  const n = tpl.n;
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  const pts = [];
  for (let k = 0; k <= n; k++) {
    let i, j;
    if (edge === 0) { i = 0; j = k; }
    else if (edge === 1) { i = n; j = k; }
    else if (edge === 2) { i = k; j = 0; }
    else { i = k; j = n; }
    pts.push(finalVertexPosition(tpl, j * (n + 1) + i, ox, oz, t, edgeUniforms));
  }
  return pts;
}

// All final vertex positions of a chunk (row-major (n+1)^2 array of [x,y,z]).
export function finalChunkPositions(cx, cz, level, t, edgeUniforms) {
  const tpl = templateFor(level);
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  const out = [];
  for (let vi = 0; vi < (tpl.n + 1) * (tpl.n + 1); vi++) {
    out.push(finalVertexPosition(tpl, vi, ox, oz, t, edgeUniforms));
  }
  return out;
}
