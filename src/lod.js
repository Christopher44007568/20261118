// Chunked LOD management shared by the renderer and the Node verifier.

import {
  CHUNK_SIZE, WORLD_CHUNKS, LEVELS, RESOLUTIONS,
  lodLevelForDistance, morphFactor, terrainHeight,
} from './terrain.js';

// Edge modes: SELF morphs the boundary with this chunk's own factor toward
// the L+1 grid (used when the neighbour is finer or absent — the finer
// neighbour follows this edge). FOLLOW snaps the boundary onto the coarser
// neighbour's live (itself morphing) edge, interpolating between the L+1
// snap and the L+2 chord snap with the neighbour's own morph factor.
export const MODE_SELF = 0;
export const MODE_FOLLOW = 1;

export function chunkCenter(cx, cz) {
  const x = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const z = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
  return [x, terrainHeight(x, z), z];
}

// LOD per chunk from 3D camera distance to chunk centre: both horizontal
// distance and camera altitude push chunks to coarser levels.
export function computeLevels(camX, camY, camZ) {
  const levels = new Uint8Array(WORLD_CHUNKS * WORLD_CHUNKS);
  for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
    for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
      const [x, y, z] = chunkCenter(cx, cz);
      const d = Math.hypot(x - camX, y - camY, z - camZ);
      levels[cz * WORLD_CHUNKS + cx] = lodLevelForDistance(d);
    }
  }
  // Safety: adjacent chunks may differ by at most one level. Distance-based
  // selection already guarantees this (band width 2^L*96 >> chunk diagonal),
  // but clamp anyway so the edge-stitching contract always holds.
  for (let pass = 0; pass < 2; pass++) {
    for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
      for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
        const i = cz * WORLD_CHUNKS + cx;
        const nb = [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]];
        for (const [nx, nz] of nb) {
          if (nx < 0 || nz < 0 || nx >= WORLD_CHUNKS || nz >= WORLD_CHUNKS) continue;
          const nl = levels[nz * WORLD_CHUNKS + nx];
          if (levels[i] > nl + 1) levels[i] = nl + 1;
        }
      }
    }
  }
  return levels;
}

// Per-chunk morph factor from camera distance to its centre.
export function computeMorphT(camX, camY, camZ, cx, cz, level) {
  const [x, y, z] = chunkCenter(cx, cz);
  return morphFactor(level, Math.hypot(x - camX, y - camY, z - camZ));
}

// Per-edge uniforms for one chunk. morphTs: per-chunk morph factor array.
// Returns { t: [L,R,B,T], mode: [L,R,B,T] } where t is the boundary morph
// factor both sides of the shared edge agree on:
//  - neighbour finer/absent: own morph factor (neighbour follows us)
//  - neighbour equal:        max(own, neighbour) — smooth through switches
//  - neighbour coarser:      neighbour's morph factor, FOLLOW mode
export function edgeUniformsFor(levels, morphTs, cx, cz) {
  const i = cz * WORLD_CHUNKS + cx;
  const my = levels[i];
  const myT = morphTs[i];
  const t = [myT, myT, myT, myT];
  const mode = [MODE_SELF, MODE_SELF, MODE_SELF, MODE_SELF];
  const nb = [[cx - 1, cz, 0], [cx + 1, cz, 1], [cx, cz - 1, 2], [cx, cz + 1, 3]];
  for (const [nx, nz, e] of nb) {
    if (nx < 0 || nz < 0 || nx >= WORLD_CHUNKS || nz >= WORLD_CHUNKS) continue;
    const ni = nz * WORLD_CHUNKS + nx;
    const nl = levels[ni];
    if (nl === my) t[e] = Math.max(myT, morphTs[ni]);
    else if (nl > my) { t[e] = morphTs[ni]; mode[e] = MODE_FOLLOW; }
  }
  return { t, mode };
}

// Grid vertex template for a level (chunk-local, shared by all chunks).
// Per vertex: local x/z and morph neighbours A/B whose live surface midpoint
// is the L+1 snap target. Boundary snap positions are derived procedurally
// (see boundaryPos in src/glsl.js / src/morphcpu.js).
export function buildLevelTemplate(level) {
  const n = RESOLUTIONS[level];
  const s = CHUNK_SIZE / n;
  const count = (n + 1) * (n + 1);
  const pos = new Float32Array(count * 2);
  const morphA = new Float32Array(count * 2);
  const morphB = new Float32Array(count * 2);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const idx = j * (n + 1) + i;
      pos[idx * 2] = i * s;
      pos[idx * 2 + 1] = j * s;
      let ai = i, aj = j, bi = i, bj = j;
      const iOdd = i % 2 === 1, jOdd = j % 2 === 1;
      if (iOdd && !jOdd) { ai = i - 1; bi = i + 1; }
      else if (!iOdd && jOdd) { aj = j - 1; bj = j + 1; }
      else if (iOdd && jOdd) { ai = i - 1; aj = j - 1; bi = i + 1; bj = j + 1; }
      morphA[idx * 2] = ai * s; morphA[idx * 2 + 1] = aj * s;
      morphB[idx * 2] = bi * s; morphB[idx * 2 + 1] = bj * s;
    }
  }
  const index = new Uint32Array(n * n * 6);
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, d = a + (n + 1), c = d + 1;
      index[k++] = a; index[k++] = c; index[k++] = b; // diagonal a-c
      index[k++] = a; index[k++] = d; index[k++] = c;
    }
  }
  return { n, step: s, pos, morphA, morphB, index };
}
