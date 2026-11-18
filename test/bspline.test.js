import assert from "node:assert/strict";
import { BSplineSurface, PATCHES } from "../src/bspline-surface.js";
import { evaluate } from "../src/evaluate.js";
import { v3 } from "../src/math.js";

function makeNet() {
  const net = [];
  for (let j = 0; j < 7; j++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      row.push([
        (i - 3) * (8 / 6),
        (j - 3) * (8 / 6),
        Math.sin(i * 0.8) * Math.cos(j * 0.7) +
          1.2 * Math.exp(-((i - 4) ** 2 + (j - 4) ** 2) / 3)
      ]);
    }
    net.push(row);
  }
  return net;
}

const surface = new BSplineSurface(makeNet());
assert.equal(surface.patches.length, 16);

// The derived Bezier grid evaluates to the same point as the B-spline cell.
for (const [u, w] of [[0, 0], [0.3, 0.6], [0.5, 0.5], [1, 1]]) {
  const direct = surface.evaluateCell(1, 1, u, w).position;
  const viaBezier = evaluate(surface.patches[1 * PATCHES + 1], u, w).position;
  assert.ok(v3.len(v3.sub(direct, viaBezier)) < 1e-10,
    `Bezier conversion matches B-spline at ${u},${w}`);
}

// C2 across an internal cell seam: position, first and second derivatives match.
const left = surface.evaluateCell(1, 1, 1, 0.5);
const right = surface.evaluateCell(2, 1, 0, 0.5);
assert.ok(v3.len(v3.sub(left.position, right.position)) < 1e-10, "C0 seam");
assert.ok(v3.len(v3.sub(left.Pu, right.Pu)) < 1e-10, "C1 seam");
assert.ok(v3.len(v3.sub(left.Puu, right.Puu)) < 1e-10, "C2 seam");

// Local move of an interior B-spline node rebuilds only its support cells
// (at most 4x4) and never the whole surface.
const snapshot = surface.patches.map((p) => p.grid);
const affected = surface.moveNode(4, 4, 2.0);
assert.ok(affected.length <= 16 && affected.length >= 1);
let untouched = 0;
surface.patches.forEach((p, k) => {
  if (!affected.includes(k)) {
    assert.equal(p.grid, snapshot[k], `patch ${k} untouched`);
    untouched++;
  }
});
assert.ok(untouched > 0, "some patches are not rebuilt");

// C2 survives the local edit.
const a = surface.evaluateCell(1, 1, 1, 0.5);
const b = surface.evaluateCell(2, 1, 0, 0.5);
assert.ok(v3.len(v3.sub(a.Puu, b.Puu)) < 1e-10, "C2 after edit");

console.log(`bspline.test.js OK (local rebuild ${affected.length}/16 patches)`);
