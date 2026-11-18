import assert from "node:assert/strict";
import { FrameBuffer } from "../src/raster.js";

const fb = new FrameBuffer(120, 100);
fb.triangle([10, 10, 0.5], [255, 0, 0],
  [110, 20, 0.5], [0, 255, 0],
  [60, 90, 0.5], [0, 0, 255]);

let lit = 0;
const d = fb.image.data;
for (let i = 0; i < 120 * 100; i++) {
  if (d[i * 4] !== 13 || d[i * 4 + 1] !== 22 || d[i * 4 + 2] !== 34) lit++;
}
assert.ok(lit > 1500, `triangle covers pixels: ${lit}`);

// Depth test: a nearer red triangle overwrites a farther blue one.
const fb2 = new FrameBuffer(40, 40);
fb2.triangle([5, 5, 0.9], [0, 0, 255], [35, 5, 0.9], [0, 0, 255], [20, 35, 0.9], [0, 0, 255]);
fb2.triangle([5, 5, 0.2], [255, 0, 0], [35, 5, 0.2], [255, 0, 0], [20, 35, 0.2], [255, 0, 0]);
const center = (20 * 40 + 20) * 4;
assert.ok(Math.abs(fb2.image.data[center] - 255) <= 1);
assert.ok(fb2.image.data[center + 2] <= 1);

// Farther triangle does not overwrite.
fb2.triangle([5, 5, 0.95], [0, 255, 0], [35, 5, 0.95], [0, 255, 0], [20, 35, 0.95], [0, 255, 0]);
assert.ok(fb2.image.data[center] >= 254);

console.log("raster.test.js OK");
