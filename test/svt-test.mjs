// Node test: drive the SVT system with a moving camera and assert invariants.
import {
  SVTSystem, TILES_PER_AXIS, NUM_TEXTURES, POOL_SLOTS,
  TILE_MISSING, TILE_PENDING,
} from '../svt.js';

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('FAIL:', msg); }
}

const svt = new SVTSystem({ tileFactory: (tex, tx, ty) => ({ tex, tx, ty }) });

// Visible tile set for a camera rect in world pixels (textures side by side).
function visibleTiles(cx, cy, viewW, viewH, ring = 1) {
  const TS = 128, out = [];
  const x0 = cx - viewW / 2 - ring * TS, y0 = cy - viewH / 2 - ring * TS;
  const x1 = cx + viewW / 2 + ring * TS, y1 = cy + viewH / 2 + ring * TS;
  for (let wy = Math.floor(y0 / TS); wy <= Math.floor(y1 / TS); wy++) {
    for (let wx = Math.floor(x0 / TS); wx <= Math.floor(x1 / TS); wx++) {
      const tex = wx < TILES_PER_AXIS ? 0 : 1;
      const tx = wx - tex * TILES_PER_AXIS;
      if (tex < NUM_TEXTURES && tx >= 0 && tx < TILES_PER_AXIS &&
          wy >= 0 && wy < TILES_PER_AXIS) {
        out.push({ tex, tx, ty: wy });
      }
    }
  }
  return out;
}

// Sweep the camera across both textures at several zoom levels (high zoom
// included) to stress page table boundaries and the residency set.
const worldW = TILES_PER_AXIS * 128 * NUM_TEXTURES;
const worldH = TILES_PER_AXIS * 128;
let fallbackFrames = 0, frames = 0;

for (const view of [256, 512, 2048, 8192]) {
  const before = { ...svt.stats };
  for (let step = 0; step < 140; step++) {
    let cx, cy;
    if (step < 120) {
      // Smooth sweep: high locality, resident set should mostly hit.
      const t = step / 119;
      cx = (worldW - view) * t + view / 2;
      cy = worldH * (0.5 + 0.3 * Math.sin(step * 0.12));
    } else {
      // Random teleports: forces cold misses, fallback blocks, re-uploads.
      const r = step * 2654435761 % 1000 / 1000;
      cx = view / 2 + (worldW - view) * r;
      cy = view / 2 + (worldH - view) * ((r * 7) % 1);
    }
    const vis = visibleTiles(cx, cy, view, view);
    svt.requestVisible(vis);
    svt.update(8);
    frames++;

    let fallbacks = 0;
    for (const { tex, tx, ty } of vis) {
      const slot = svt.lookup(tex, tx, ty);
      if (!slot) { fallbacks++; continue; }
      // Invariant: a resident lookup must never return a foreign tile
      // (the "wrong neighbor texture" bug).
      assert(slot.tex === tex && slot.tx === tx && slot.ty === ty,
        `stale mapping at tex=${tex} (${tx},${ty}) -> slot holds ` +
        `tex=${slot.tex} (${slot.tx},${slot.ty})`);
    }
    if (fallbacks > 0) fallbackFrames++;
  }
  const h = svt.stats.hits - before.hits, m = svt.stats.misses - before.misses;
  console.log(`view=${view} hitRate=${(100 * h / (h + m)).toFixed(1)}% ` +
    `uploads=+${svt.stats.uploads - before.uploads} ` +
    `evictions=+${svt.stats.evictions - before.evictions}`);
}

// Page table integrity: every resident entry points at a slot that agrees,
// and every occupied slot is referenced by exactly one page table entry.
const refCount = new Array(svt.slots.length).fill(0);
for (let tex = 0; tex < NUM_TEXTURES; tex++) {
  for (let i = 0; i < TILES_PER_AXIS * TILES_PER_AXIS; i++) {
    const e = svt.pageTable[tex][i];
    if (e >= 0) {
      const s = svt.slots[e];
      assert(!s.free, `page table points at free slot ${e}`);
      assert(s.tex === tex && s.ty * TILES_PER_AXIS + s.tx === i,
        `slot ${e} disagrees with page table entry tex=${tex} idx=${i}`);
      refCount[e]++;
    } else {
      assert(e === TILE_MISSING || e === TILE_PENDING, `bad entry ${e}`);
    }
  }
}
for (let i = 0; i < svt.slots.length; i++) {
  const occupied = !svt.slots[i].free;
  assert(refCount[i] === (occupied ? 1 : 0),
    `slot ${i} refCount=${refCount[i]} occupied=${occupied}`);
}

assert(svt.stats.evictions > 0, 'expected evictions during the sweep');
assert(svt.stats.uploads > POOL_SLOTS, 'expected more uploads than pool size');
assert(svt.poolUsage() <= POOL_SLOTS, 'pool over capacity');

const hitRate = svt.stats.hits / (svt.stats.hits + svt.stats.misses);
console.log(`frames=${frames} uploads=${svt.stats.uploads} ` +
  `evictions=${svt.stats.evictions} hitRate=${(hitRate * 100).toFixed(1)}% ` +
  `fallbackFrames=${fallbackFrames}`);
console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
