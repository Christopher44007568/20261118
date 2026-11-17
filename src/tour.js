// Procedural valley / ridge tour paths over the heightfield.

import { WORLD_SIZE, terrainHeight } from './terrain.js';

function sampleExtremum(cx, cz, radius, step, findMax) {
  let best = findMax ? -Infinity : Infinity;
  let bx = cx, bz = cz;
  for (let z = cz - radius; z <= cz + radius; z += step) {
    for (let x = cx - radius; x <= cx + radius; x += step) {
      if (x < 32 || z < 32 || x > WORLD_SIZE - 32 || z > WORLD_SIZE - 32) continue;
      const h = terrainHeight(x, z);
      if ((findMax && h > best) || (!findMax && h < best)) {
        best = h; bx = x; bz = z;
      }
    }
  }
  return [bx, bz];
}

// Follow a ridge (findMax) or valley (!findMax) by greedily stepping toward
// the most extreme height on a forward fan, with heading momentum.
export function tracePath(findMax, steps = 140, stepLen = 14) {
  const c = WORLD_SIZE / 2;
  let [x, z] = sampleExtremum(c, c, WORLD_SIZE * 0.45, 24, findMax);
  let heading = Math.atan2(c - z, c - x); // start walking toward world centre
  const pts = [[x, z]];
  for (let s = 0; s < steps; s++) {
    let bestScore = findMax ? -Infinity : Infinity;
    let bx = x, bz = z, bh = heading;
    for (let a = -1.1; a <= 1.1; a += 0.22) {
      const h = heading + a;
      const nx = x + Math.cos(h) * stepLen;
      const nz = z + Math.sin(h) * stepLen;
      if (nx < 32 || nz < 32 || nx > WORLD_SIZE - 32 || nz > WORLD_SIZE - 32) continue;
      const v = terrainHeight(nx, nz);
      const score = findMax ? v : -v;
      const bs = findMax ? bestScore : -bestScore;
      if (score > bs || (score === bs && Math.abs(a) < Math.abs(bh - heading))) {
        bestScore = findMax ? score : -score;
        bx = nx; bz = nz; bh = h;
      }
    }
    heading = bh;
    x = bx; z = bz;
    pts.push([x, z]);
  }
  return pts;
}

export const valleyPath = () => tracePath(false);
export const ridgePath = () => tracePath(true);
