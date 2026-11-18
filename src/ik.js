import * as THREE from 'three';

export const DEG = Math.PI / 180;

export const DEFAULT_LIMITS = Object.freeze({
  hipMin: -55 * DEG,
  hipMax: 82 * DEG,
  kneeMin: 0,
  kneeMax: 145 * DEG,
  ankleMin: 58 * DEG,
  ankleMax: 124 * DEG,
});

const EPSILON = 1e-7;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function signedAngleFromDown(direction) {
  return Math.atan2(direction.z, -direction.y);
}

export function solveTwoBoneIK({
  hip,
  target,
  pole = new THREE.Vector3(0, 0, 1),
  upperLength,
  lowerLength,
  limits = DEFAULT_LIMITS,
}) {
  if (!(upperLength > 0) || !(lowerLength > 0)) {
    throw new Error('Bone lengths must be positive.');
  }

  const config = { ...DEFAULT_LIMITS, ...limits };
  const delta = target.clone().sub(hip);
  const planarDistance = Math.hypot(delta.y, delta.z);
  const maxReach = upperLength + lowerLength;
  const minReach = Math.abs(upperLength - lowerLength) + EPSILON;
  const boundedDistance = clamp(planarDistance, minReach, maxReach - EPSILON);

  let kneeAngle;
  if (boundedDistance >= maxReach - EPSILON) {
    kneeAngle = 0;
  } else if (boundedDistance <= minReach + EPSILON) {
    kneeAngle = Math.PI;
  } else {
    const interior = Math.acos(
      clamp(
        (upperLength ** 2 + lowerLength ** 2 - boundedDistance ** 2) /
          (2 * upperLength * lowerLength),
        -1,
        1,
      ),
    );
    kneeAngle = Math.PI - interior;
  }

  const rawKneeAngle = kneeAngle;
  kneeAngle = clamp(kneeAngle, config.kneeMin, config.kneeMax);

  const reach = Math.sqrt(
    upperLength ** 2 +
      lowerLength ** 2 +
      2 * upperLength * lowerLength * Math.cos(kneeAngle),
  );
  const hipOffset = Math.acos(
    clamp(
      (upperLength ** 2 + reach ** 2 - lowerLength ** 2) /
        (2 * upperLength * reach),
      -1,
      1,
    ),
  );

  const desiredChainAngle =
    planarDistance > EPSILON ? Math.atan2(delta.z, -delta.y) : 0;
  const desiredHipAngle = desiredChainAngle + hipOffset;
  const hipAngle = clamp(desiredHipAngle, config.hipMin, config.hipMax);
  const chainAngle = hipAngle - hipOffset;

  const poleSign = Math.sign(pole.z) || 1;
  const thighDirection = new THREE.Vector3(
    0,
    -Math.cos(hipAngle),
    Math.sin(hipAngle) * poleSign,
  );
  const chainDirection = new THREE.Vector3(
    0,
    -Math.cos(chainAngle),
    Math.sin(chainAngle) * poleSign,
  );

  const knee = hip.clone().addScaledVector(thighDirection, upperLength);
  const ankle = hip.clone().addScaledVector(chainDirection, reach);
  const shinDirection = ankle.clone().sub(knee).normalize();
  const targetError = ankle.distanceTo(target);
  const outOfReach = planarDistance >= maxReach - EPSILON;
  const tooClose = planarDistance <= minReach + EPSILON;

  return {
    hip: hip.clone(),
    ankle,
    knee,
    thighDirection,
    shinDirection,
    chainDirection,
    chainAngle,
    hipAngle,
    kneeAngle,
    reach,
    targetError,
    planarDistance,
    maxReach,
    outOfReach,
    tooClose,
    kneeClamped:
      Math.abs(rawKneeAngle - kneeAngle) > EPSILON || kneeAngle >= config.kneeMax,
    hipClamped: Math.abs(desiredHipAngle - hipAngle) > EPSILON,
    straight: kneeAngle <= EPSILON,
  };
}

export function solveAnkle({
  shinDirection,
  desiredPitch = 0,
  limits = DEFAULT_LIMITS,
}) {
  const shinAngle = signedAngleFromDown(shinDirection);
  const desiredJointAngle = Math.PI / 2 - shinAngle + desiredPitch;
  const jointAngle = clamp(
    desiredJointAngle,
    limits.ankleMin,
    limits.ankleMax,
  );
  const pitch = jointAngle + shinAngle - Math.PI / 2;
  const forward = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
  const up = new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch));

  return {
    jointAngle,
    pitch,
    forward,
    up,
    clamped: Math.abs(desiredJointAngle - jointAngle) > EPSILON,
  };
}

export function boneQuaternion(direction, pole = new THREE.Vector3(0, 0, 1)) {
  const yAxis = direction.clone().normalize().negate();
  const zAxis = pole.clone().addScaledVector(yAxis, -pole.dot(yAxis));

  if (zAxis.lengthSq() < EPSILON) {
    const fallback = Math.abs(yAxis.y) < 0.98
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
    zAxis.copy(fallback).addScaledVector(yAxis, -fallback.dot(yAxis));
  }

  zAxis.normalize();
  const xAxis = yAxis.clone().cross(zAxis).normalize();
  zAxis.copy(xAxis).cross(yAxis).normalize();

  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

export function footQuaternion(ankleSolution) {
  const xAxis = ankleSolution.up.clone().cross(ankleSolution.forward).normalize();
  const yAxis = ankleSolution.up.clone().normalize();
  const zAxis = ankleSolution.forward.clone().normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}

export function segmentLength(a, b) {
  return a.distanceTo(b);
}

export function rigIntegrity({ hip, knee, ankle, upperLength, lowerLength }) {
  const upperError = Math.abs(segmentLength(hip, knee) - upperLength);
  const lowerError = Math.abs(segmentLength(knee, ankle) - lowerLength);

  return {
    upperError,
    lowerError,
    maxLengthError: Math.max(upperError, lowerError),
    valid: upperError < 1e-8 && lowerError < 1e-8,
  };
}
