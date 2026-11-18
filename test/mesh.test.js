import assert from "node:assert/strict";
import { SurfaceModel, PATCHES } from "../src/surface.js";
import { createInitialNodes } from "../src/evaluate.js";
import { Camera } from "../src/camera.js";
import { Tessellator } from "../src/tessellate.js";
import { v3 } from "../src/math.js";

const camera = new Camera({
  width: 1400,
  height: 900,
  eye: [4.6, -10.8, 11.0],
  center: [0, 0, 0]
});
const surface = new SurfaceModel(createInitialNodes());
const tess = new Tessellator(camera, 0.32);
tess.computeLevels(surface);

const meshes = tess.buildAll(surface);
for (const r of tess.uLevels) for (const n of r) {
  assert.ok(n >= 4 && n <= 32, "u level within adaptive range");
  assert.ok(Number.isInteger(n), "discrete u level");
}
for (const r of tess.vLevels) for (const n of r) {
  assert.ok(n >= 4 && n <= 32, "level within adaptive range");
  assert.ok(Number.isInteger(n), "discrete level");
}

// Seam samples of neighbouring patches project to identical pixels: no cracks.
for (let r = 0; r < PATCHES; r++) {
  for (let c = 0; c < PATCHES - 1; c++) {
    const a = meshes[r * PATCHES + c];
    const b = meshes[r * PATCHES + c + 1];
    assert.equal(a.nv, b.nv, "v level shared across vertical seam");
    for (let j = 0; j <= a.nv; j += 1) {
      const pa = a.screen[j * (a.nu + 1) + a.nu];
      const pb = b.screen[j * (b.nu + 1)];
      assert.ok(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 1e-9,
        `vertical seam gap r=${r} j=${j}`);
    }
  }
}
for (let r = 0; r < PATCHES - 1; r++) {
  for (let c = 0; c < PATCHES; c++) {
    const a = meshes[r * PATCHES + c];
    const b = meshes[(r + 1) * PATCHES + c];
    assert.equal(a.nu, b.nu, "u level shared across horizontal seam");
    for (let i = 0; i <= a.nu; i += 1) {
      const pa = a.screen[a.nv * (a.nu + 1) + i];
      const pb = b.screen[i];
      assert.ok(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 1e-9,
        `horizontal seam gap r=${r} i=${i}`);
    }
  }
}

// Triangle bookkeeping.
let totalTri = 0;
for (const m of meshes) {
  assert.equal(m.triangles.length, m.nu * m.nv * 2);
  assert.equal(m.positions.length, (m.nu + 1) * (m.nv + 1));
  totalTri += m.triangles.length;
}
assert.ok(totalTri > 1000, "substantial tessellation");

// Flat corner must use fewer segments than the bumpy region.
const flat = tess.uLevels[3][0] + tess.vLevels[3][0];
const dense = tess.uLevels[0][3] + tess.vLevels[0][3];
assert.ok(dense > flat, `adaptive density: dense=${dense} flat=${flat}`);

// Local re-level: only touched strips change after a node move.
const beforeU = tess.uLevels.map((r) => [...r]);
const beforeV = tess.vLevels.map((r) => [...r]);
const affected = surface.moveNode(2, 2, 3.0);
tess.computeLevels(surface, new Set(affected));
const rebuilt = tess.buildAll(surface);
// Seam reconciliation only propagates through rows/columns that touch a
// dirty patch. A patch sharing neither (bottom-right corner here) keeps its
// exact previous levels -> no global re-tessellation.
assert.equal(tess.uLevels[3][3], beforeU[3][3], "isolated patch u untouched");
assert.equal(tess.vLevels[3][3], beforeV[3][3], "isolated patch v untouched");
assert.ok(affected.length < PATCHES * PATCHES, "update stays local");
// Rebuilt meshes stay watertight.
for (let r = 0; r < PATCHES; r++) {
  for (let c = 0; c < PATCHES - 1; c++) {
    const a = rebuilt[r * PATCHES + c];
    const b = rebuilt[r * PATCHES + c + 1];
    assert.equal(a.nv, b.nv);
  }
}
for (let r = 0; r < PATCHES - 1; r++) {
  for (let c = 0; c < PATCHES; c++) {
    const a = rebuilt[r * PATCHES + c];
    const b = rebuilt[(r + 1) * PATCHES + c];
    assert.equal(a.nu, b.nu);
  }
}

// All mesh normals are unit length.
for (const m of meshes) for (const n of m.normals) {
  assert.ok(Math.abs(v3.len(n) - 1) < 1e-9);
}

console.log(`mesh.test.js OK (triangles=${totalTri}, uPerCol=[${tess.colSegments}], vPerRow=[${tess.rowSegments}])`);
