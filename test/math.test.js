import assert from "node:assert/strict";
import { bernstein, bernsteinDeriv, v3, mul4, transformPoint } from "../src/math.js";

// Bernstein partition of unity and endpoint interpolation.
for (const t of [0, 0.25, 0.5, 0.75, 1]) {
  const b = bernstein(t);
  assert.ok(Math.abs(b.reduce((s, x) => s + x, 0) - 1) < 1e-12, `partition at ${t}`);
  const d = bernsteinDeriv(t);
  assert.ok(Math.abs(d.reduce((s, x) => s + x, 0)) < 1e-12, `derivative sums to zero at ${t}`);
  // Numerical derivative of the basis agrees with bernsteinDeriv.
  const h = 1e-6;
  const bp = bernstein(Math.min(1, t + h));
  const bm = bernstein(Math.max(0, t - h));
  const denom = (Math.min(1, t + h) - Math.max(0, t - h));
  for (let k = 0; k < 4; k++) {
    assert.ok(Math.abs((bp[k] - bm[k]) / denom - d[k]) < 1e-5, `deriv k=${k} at ${t}`);
  }
}

// Identity matrix leaves points unchanged.
const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
assert.deepEqual(mul4(id, id), id);
assert.deepEqual(transformPoint(id, [1, 2, 3]), [1, 2, 3]);

// Cross product is perpendicular to both inputs.
const n = v3.cross([1, 0, 0], [0, 1, 0]);
assert.deepEqual(n, [0, 0, 1]);

console.log("math.test.js OK");
