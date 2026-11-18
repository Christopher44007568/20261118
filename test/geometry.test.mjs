import test from "node:test";
import assert from "node:assert/strict";
import { FIELDS, getField } from "../src/fields.js";
import { sampleGrid } from "../src/grid.js";
import { extractSurfaceNets } from "../src/surface-nets.js";
import { extractMarchingCubes } from "../src/marching-cubes.js";
import { validateMesh } from "../src/validate.js";
import { meshToObj } from "../src/exporters.js";

function extract(fieldId, iso = 0, options = {}) {
  const field = getField(fieldId);
  const grid = sampleGrid(field, {
    resolution: options.resolution ?? 42,
    iso,
  });
  const surfaceNets = extractSurfaceNets(grid, {
    smoothing: options.smoothing ?? field.smoothing,
  });
  const marchingCubes = extractMarchingCubes(grid);
  return {
    field,
    grid,
    surfaceNets,
    marchingCubes,
    snValidation: validateMesh(surfaceNets),
    mcValidation: validateMesh(marchingCubes),
  };
}

test("Surface Nets emits one vertex per crossing voxel", () => {
  const { surfaceNets, snValidation } = extract("sphere");
  assert.equal(surfaceNets.vertexCount, surfaceNets.activeCells);
  assert.ok(surfaceNets.faceCount > 0);
  assert.equal(snValidation.duplicateFaces, 0);
  assert.equal(snValidation.duplicateGeometricFaces, 0);
});

test("Surface Nets output is closed and continuously connected", () => {
  const { surfaceNets, snValidation } = extract("union");
  assert.equal(snValidation.boundaryEdges, 0);
  assert.equal(snValidation.nonManifoldEdges, 0);
  assert.equal(snValidation.inconsistentEdges, 0);
  assert.equal(snValidation.connectedComponents, 1);
  assert.equal(snValidation.continuous, true);
  assert.equal(snValidation.passed, true);
  assert.equal(surfaceNets.quadCount ?? surfaceNets.faceCount, surfaceNets.faceCount);
});

test("threshold updates preserve manifold connectivity", () => {
  const thresholds = [-0.06, -0.02, 0, 0.035, 0.07];
  for (const iso of thresholds) {
    const { surfaceNets, snValidation } = extract("union", iso);
    assert.ok(surfaceNets.faceCount > 0);
    assert.equal(snValidation.duplicateFaces, 0);
    assert.equal(snValidation.boundaryEdges, 0);
    assert.equal(snValidation.nonManifoldEdges, 0);
    assert.equal(snValidation.connectedComponents, 1);
    assert.equal(snValidation.normalsValid, true);
  }
});

test("Surface Nets emits roughly half as many polygon faces as marching cubes", () => {
  const { surfaceNets, marchingCubes } = extract("sphere");
  assert.ok(
    Math.abs(surfaceNets.vertexCount - marchingCubes.vertexCount)
      < surfaceNets.vertexCount * 0.01,
  );
  assert.ok(surfaceNets.faceCount < marchingCubes.faceCount * 0.55);
  assert.ok(surfaceNets.faceCount > marchingCubes.faceCount * 0.45);
  assert.ok(marchingCubes.faceCount > 0);
});

test("sharp field uses a lower smoothing coefficient than smooth fields", () => {
  assert.ok(getField("sharp").smoothing < getField("union").smoothing * 0.5);
  assert.ok(getField("sharp").smoothing <= 0.12);
});

test("all fields validate across their threshold range", () => {
  for (const field of FIELDS) {
    for (const fraction of [0.12, 0.5, 0.88]) {
      const iso = field.threshold.min
        + (field.threshold.max - field.threshold.min) * fraction;
      const { surfaceNets, snValidation } = extract(field.id, iso);
      assert.ok(surfaceNets.faceCount > 0, `${field.id} iso=${iso}`);
      assert.equal(snValidation.duplicateFaces, 0, `${field.id} iso=${iso}`);
      assert.equal(snValidation.duplicateGeometricFaces, 0, `${field.id} iso=${iso}`);
      assert.equal(snValidation.boundaryEdges, 0, `${field.id} iso=${iso}`);
      assert.equal(snValidation.nonManifoldEdges, 0, `${field.id} iso=${iso}`);
      assert.equal(snValidation.inconsistentEdges, 0, `${field.id} iso=${iso}`);
      assert.equal(snValidation.connectedComponents, 1, `${field.id} iso=${iso}`);
    }
  }
});

test("OBJ export includes vertex normals and quad faces", () => {
  const { surfaceNets } = extract("sphere");
  const obj = meshToObj(surfaceNets, "sphere");
  assert.match(obj, /^v /m);
  assert.match(obj, /^vn /m);
  assert.match(obj, /^f \d+\/\/\d+ \d+\/\/\d+ \d+\/\/\d+ \d+\/\/\d+$/m);
});
