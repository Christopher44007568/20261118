import assert from "node:assert/strict";
import { SurfaceModel, PATCHES } from "../src/surface.js";
import { createInitialNodes, evaluate } from "../src/evaluate.js";
import { v3 } from "../src/math.js";

const surface = new SurfaceModel(createInitialNodes());
assert.equal(surface.patches.length, PATCHES * PATCHES);

// Every patch is a 4x4 Bezier control grid.
for (const p of surface.patches) {
  assert.equal(p.grid.length, 4);
  assert.equal(p.grid[0].length, 4);
}

// Shared boundary control points are identical objects-coordinates.
for (let r = 0; r < PATCHES; r++) {
  for (let c = 0; c < PATCHES - 1; c++) {
    const left = surface.patches[r * PATCHES + c];
    const right = surface.patches[r * PATCHES + c + 1];
    for (let j = 0; j < 4; j++) {
      assert.deepEqual(left.grid[j][3], right.grid[j][0], `seam v c=${c} r=${r} j=${j}`);
    }
  }
}

// Exact C1: tangents from both sides of an internal seam match.
const left = surface.patches[1 * PATCHES + 1];
const right = surface.patches[1 * PATCHES + 2];
for (const v of [0, 0.3, 0.7, 1]) {
  const a = evaluate(left, 1, v).Pu;
  const b = evaluate(right, 0, v).Pu;
  assert.ok(v3.len(v3.sub(a, b)) < 1e-11, `C1 tangent at v=${v}`);
}
const top = surface.patches[1 * PATCHES + 1];
const bottom = surface.patches[2 * PATCHES + 1];
for (const u of [0, 0.3, 0.7, 1]) {
  const a = evaluate(top, u, 1).Pv;
  const b = evaluate(bottom, u, 0).Pv;
  assert.ok(v3.len(v3.sub(a, b)) < 1e-11, `C1 tangent at u=${u}`);
}

// Local update: moving an interior node rebuilds exactly 4 patches and leaves
// every other patch grid instance untouched.
const snapshot = surface.patches.map((p) => p.grid);
const before = surface.nodes[2][2][2];
const affected = surface.moveNode(2, 2, before + 1.25);
// Forward-difference tangents widen the closure to the 3x3 block above-left.
assert.deepEqual(affected, [0, 1, 2, 4, 5, 6, 8, 9, 10]);
let untouched = 0;
surface.patches.forEach((p, k) => {
  if (!affected.includes(k)) {
    assert.equal(p.grid, snapshot[k], `patch ${k} must not be rebuilt`);
    untouched++;
  }
});
assert.equal(untouched, 16 - affected.length);
assert.equal(surface.nodes[2][2][2], before + 1.25);

// Edge node touches a narrow strip; corner node touches 1.
assert.deepEqual(new Set(surface.moveNode(0, 2, 0.4)), new Set([0, 4, 8]));
assert.deepEqual(new Set(surface.moveNode(0, 0, 0.2)), new Set([0]));

// C1 still holds after the edit.
const l2 = surface.patches[1 * PATCHES + 1];
const r2 = surface.patches[1 * PATCHES + 2];
assert.ok(v3.len(v3.sub(evaluate(l2, 1, 0.5).Pu, evaluate(r2, 0, 0.5).Pu)) < 1e-11);

// Edge-row move must preserve C1 against the untouched neighbouring row:
// every internal seam (both axes) stays tangent-continuous.
const edgeAffected = surface.moveNode(2, 4, 1.1);
assert.ok(edgeAffected.length <= 6, `local scope stays small: ${edgeAffected.length}`);
for (let r = 0; r < PATCHES - 1; r++) {
  for (let c = 0; c < PATCHES; c++) {
    const top = surface.patches[r * PATCHES + c];
    const bottom = surface.patches[(r + 1) * PATCHES + c];
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      assert.ok(v3.len(v3.sub(evaluate(top, u, 1).Pv, evaluate(bottom, u, 0).Pv)) < 1e-11,
        `C1 after edge move r=${r} c=${c} u=${u}`);
    }
  }
}

console.log("surface.test.js OK");
