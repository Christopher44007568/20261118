import assert from "node:assert/strict";
import test from "node:test";
import {
  MORPH_TARGETS,
  applyMorphTargets,
  computeFaceNormals,
  createFaceMesh,
  maxVertexDisplacement,
  runStabilityTest,
} from "../src/morph.js";

const mesh = createFaceMesh();

test("builds one mesh with three position and normal targets", () => {
  assert.equal(mesh.targets.length, 3);
  assert.deepEqual(
    mesh.targets.map((target) => target.id),
    MORPH_TARGETS.map((target) => target.id),
  );
  assert.equal(mesh.base.positions.length, mesh.vertexCount * 3);
  assert.equal(mesh.base.normals.length, mesh.vertexCount * 3);
  assert.equal(mesh.triangles.length, 4248 * 3);
  for (const target of mesh.targets) {
    assert.equal(target.positions.length, mesh.base.positions.length);
    assert.equal(target.normals.length, mesh.base.normals.length);
  }
});

test("clamps out-of-range weights before blending", () => {
  const pose = applyMorphTargets(mesh, {
    smile: 99,
    blink: -3,
    brow: 1.2,
  });
  assert.deepEqual(pose.weights, { smile: 1, blink: 0, brow: 1 });
  assert.equal(pose.limited.length, 3);
  assert.equal(pose.appliedWeights.smile, 1);
  assert.equal(pose.appliedWeights.blink, 0);
  assert.equal(pose.appliedWeights.brow, 1);
});

test("blends positions from the immutable base plus target deltas", () => {
  const pose = applyMorphTargets(mesh, { smile: 0.4, blink: 0, brow: 0 });
  const smile = mesh.targets.find((target) => target.id === "smile");
  let largestError = 0;
  for (let index = 0; index < mesh.base.positions.length; index += 1) {
    const expected =
      mesh.base.positions[index] +
      (smile.positions[index] - mesh.base.positions[index]) * 0.4;
    largestError = Math.max(
      largestError,
      Math.abs(pose.positions[index] - expected),
    );
  }
  assert.ok(largestError < 1e-6);
});

test("blends and normalizes base and target normals", () => {
  const neutral = applyMorphTargets(mesh, { smile: 0, blink: 0, brow: 0 });
  const brow = applyMorphTargets(mesh, { smile: 0, blink: 0, brow: 1 });
  let changedNormals = 0;
  let largestLengthError = 0;
  for (let index = 0; index < brow.normals.length; index += 3) {
    const length = Math.hypot(
      brow.normals[index],
      brow.normals[index + 1],
      brow.normals[index + 2],
    );
    largestLengthError = Math.max(largestLengthError, Math.abs(length - 1));
    const difference = Math.hypot(
      brow.normals[index] - neutral.normals[index],
      brow.normals[index + 1] - neutral.normals[index + 1],
      brow.normals[index + 2] - neutral.normals[index + 2],
    );
    if (difference > 1e-4) changedNormals += 1;
  }
  assert.ok(changedNormals > 10);
  assert.ok(largestLengthError < 1e-6);
});

test("single target and combined pose expose a measurable difference", () => {
  const single = applyMorphTargets(mesh, { smile: 1, blink: 0, brow: 0 });
  const blinkOnly = applyMorphTargets(mesh, { smile: 0, blink: 1, brow: 0 });
  const combined = applyMorphTargets(mesh, { smile: 1, blink: 1, brow: 1 });
  const difference = maxVertexDisplacement(single.positions, combined.positions);
  assert.ok(difference > 0.05);
  assert.ok(combined.maxDisplacement > blinkOnly.maxDisplacement);
});

test("extreme combined weights stay free of flips and silhouette intersection", () => {
  const pose = applyMorphTargets(mesh, {
    smile: 25,
    blink: 18,
    brow: 30,
  });
  assert.equal(pose.triangleFlips, 0);
  assert.equal(pose.outlineSelfIntersects, false);
  assert.ok(pose.safetyScale > 0);
  assert.ok(pose.maxDisplacement > 0);
});

test("safety attenuation resolves a synthetic folded target", () => {
  const positions = new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    1, 1, 0,
    -1, 1, 0,
  ]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const targetPositions = positions.slice();
  targetPositions[0] = 1.8;
  targetPositions[1] = -0.2;
  const triangles = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const synthetic = {
    vertexCount: 4,
    base: { positions, normals },
    targets: [
      {
        id: "smile",
        positions: targetPositions,
        normals: normals.slice(),
      },
    ],
    triangles,
    outline: new Uint32Array([0, 1, 2, 3]),
    faceNormals: computeFaceNormals(positions, triangles),
  };
  const pose = applyMorphTargets(synthetic, { smile: 1, blink: 0, brow: 0 });
  assert.ok(pose.safetyScale < 1);
  assert.equal(pose.triangleFlips, 0);
  assert.equal(pose.outlineSelfIntersects, false);
});

test("repeated switching does not accumulate into the base mesh", () => {
  const basePositions = mesh.base.positions.slice();
  const baseNormals = mesh.base.normals.slice();
  const result = runStabilityTest(mesh, { cycles: 320 });
  assert.equal(result.passed, true);
  assert.ok(result.maxPositionResidual < 1e-7);
  assert.ok(result.maxNormalResidual < 1e-7);
  assert.ok(maxVertexDisplacement(mesh.base.positions, basePositions) < 1e-7);
  let normalDrift = 0;
  for (let index = 0; index < baseNormals.length; index += 1) {
    normalDrift = Math.max(
      normalDrift,
      Math.abs(mesh.base.normals[index] - baseNormals[index]),
    );
  }
  assert.ok(normalDrift < 1e-7);
});
