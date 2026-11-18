import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  DEFAULT_LIMITS,
  boneQuaternion,
  footQuaternion,
  rigIntegrity,
  solveAnkle,
  solveTwoBoneIK,
} from '../src/ik.js';

const upperLength = 1.5;
const lowerLength = 1.45;
const hip = new THREE.Vector3(0, 3, 0);
const pole = new THREE.Vector3(0, 0, 1);

const solve = (target, limits = DEFAULT_LIMITS) =>
  solveTwoBoneIK({
    hip,
    target,
    pole,
    upperLength,
    lowerLength,
    limits,
  });

const assertNear = (actual, expected, epsilon, message) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${expected}, received ${actual}`,
  );
};

test('reachable targets are solved exactly with fixed segment lengths', () => {
  const target = new THREE.Vector3(0, 1.2, 1.55);
  const result = solve(target);
  const integrity = rigIntegrity({ hip, ...result, upperLength, lowerLength });

  assert.ok(result.targetError < 1e-8);
  assert.ok(integrity.valid);
  assert.ok(result.hipAngle >= DEFAULT_LIMITS.hipMin);
  assert.ok(result.hipAngle <= DEFAULT_LIMITS.hipMax);
  assert.ok(result.kneeAngle >= DEFAULT_LIMITS.kneeMin);
  assert.ok(result.kneeAngle <= DEFAULT_LIMITS.kneeMax);
  assert.ok(result.knee.z > hip.z);
});

test('targets beyond reach produce a straight, stable chain', () => {
  const target = new THREE.Vector3(0, 1.3, 5.5);
  const result = solve(target);
  const integrity = rigIntegrity({ hip, ...result, upperLength, lowerLength });
  const expectedError = target.distanceTo(
    hip.clone().addScaledVector(result.chainDirection, upperLength + lowerLength),
  );

  assert.ok(result.outOfReach);
  assertNear(result.kneeAngle, 0, 1e-10, 'knee should be straight');
  assertNear(result.targetError, expectedError, 1e-7, 'error should match reach');
  assert.ok(integrity.valid);

  const first = result.knee.clone();
  for (let i = 0; i < 120; i += 1) {
    const jitter = new THREE.Vector3(
      Math.sin(i * 1.7) * 0.001,
      Math.cos(i * 2.3) * 0.001,
      0,
    );
    const repeated = solve(target.clone().add(jitter));
    assertNear(repeated.kneeAngle, 0, 1e-10, 'boundary must not jitter');
    assert.ok(repeated.knee.distanceTo(first) < 0.004);
  }
});

test('close targets clamp at the maximum knee angle', () => {
  const result = solve(new THREE.Vector3(0, 2.7, 0.1));
  const integrity = rigIntegrity({ hip, ...result, upperLength, lowerLength });

  assertNear(result.kneeAngle, DEFAULT_LIMITS.kneeMax, 1e-10, 'knee clamp');
  assert.ok(result.kneeClamped);
  assert.ok(result.targetError > 0);
  assert.ok(integrity.valid);
});

test('hip and ankle limits are respected without changing bone lengths', () => {
  const hipLimited = solve(new THREE.Vector3(0, 2.2, 1.8), {
    ...DEFAULT_LIMITS,
    hipMax: 65 * (Math.PI / 180),
  });
  const ankle = solveAnkle({
    shinDirection: hipLimited.shinDirection,
    desiredPitch: -80 * (Math.PI / 180),
    limits: DEFAULT_LIMITS,
  });
  const integrity = rigIntegrity({
    hip,
    ...hipLimited,
    upperLength,
    lowerLength,
  });

  assertNear(hipLimited.hipAngle, 65 * (Math.PI / 180), 1e-10, 'hip clamp');
  assert.ok(hipLimited.hipClamped);
  assertNear(ankle.jointAngle, DEFAULT_LIMITS.ankleMin, 1e-10, 'ankle clamp');
  assert.ok(ankle.clamped);
  assert.ok(integrity.valid);
});

test('bone and foot bases stay orthonormal and right-handed', () => {
  const result = solve(new THREE.Vector3(0, 1.4, 1.3));
  const ankle = solveAnkle({ shinDirection: result.shinDirection });
  const quaternions = [
    boneQuaternion(result.thighDirection, pole),
    boneQuaternion(result.shinDirection, pole),
    footQuaternion(ankle),
  ];

  for (const quaternion of quaternions) {
    const matrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
    assertNear(matrix.determinant(), 1, 1e-10, 'rotation determinant');
    const axes = [
      new THREE.Vector3().setFromMatrixColumn(matrix, 0),
      new THREE.Vector3().setFromMatrixColumn(matrix, 1),
      new THREE.Vector3().setFromMatrixColumn(matrix, 2),
    ];
    assertNear(axes[0].length(), 1, 1e-10, 'x axis length');
    assertNear(axes[1].length(), 1, 1e-10, 'y axis length');
    assertNear(axes[2].length(), 1, 1e-10, 'z axis length');
    assertNear(axes[0].dot(axes[1]), 0, 1e-10, 'axes orthogonal');
  }
});
