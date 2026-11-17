// Skeleton definition, bind pose, pose evaluation and crossfade blending.
import { Mat4, Quat, Vec3 } from './math.js';

// Humanoid rig, 17 bones. bindPos is the world-space joint position in the
// bind pose (T-pose, feet just above the y=0 ground plane).
export const BONES = [
  { name: 'hips',      parent: -1, bindPos: [0.00, 0.98, 0.00] },
  { name: 'spine',     parent: 0,  bindPos: [0.00, 1.12, 0.00] },
  { name: 'chest',     parent: 1,  bindPos: [0.00, 1.30, 0.00] },
  { name: 'neck',      parent: 2,  bindPos: [0.00, 1.45, 0.00] },
  { name: 'head',      parent: 3,  bindPos: [0.00, 1.56, 0.00] },
  { name: 'upperArmL', parent: 2,  bindPos: [0.22, 1.40, 0.00] },
  { name: 'lowerArmL', parent: 5,  bindPos: [0.48, 1.40, 0.00] },
  { name: 'handL',     parent: 6,  bindPos: [0.72, 1.40, 0.00] },
  { name: 'upperArmR', parent: 2,  bindPos: [-0.22, 1.40, 0.00] },
  { name: 'lowerArmR', parent: 8,  bindPos: [-0.48, 1.40, 0.00] },
  { name: 'handR',     parent: 9,  bindPos: [-0.72, 1.40, 0.00] },
  { name: 'upperLegL', parent: 0,  bindPos: [0.10, 0.95, 0.00] },
  { name: 'lowerLegL', parent: 11, bindPos: [0.10, 0.52, 0.00] },
  { name: 'footL',     parent: 12, bindPos: [0.10, 0.12, 0.00] },
  { name: 'upperLegR', parent: 0,  bindPos: [-0.10, 0.95, 0.00] },
  { name: 'lowerLegR', parent: 14, bindPos: [-0.10, 0.52, 0.00] },
  { name: 'footR',     parent: 15, bindPos: [-0.10, 0.12, 0.00] },
];

export const BONE_COUNT = BONES.length;
export const boneIndex = (name) => BONES.findIndex((b) => b.name === name);

// Bind-pose local transforms (identity rotation, offset from parent) and
// world matrices; inverse bind matrices drive the skinning palette.
export const BIND_LOCAL = BONES.map((b) => {
  const t = b.parent < 0
    ? b.bindPos.slice()
    : Vec3.sub(b.bindPos, BONES[b.parent].bindPos);
  return { rot: Quat.identity(), pos: t };
});

export const BIND_WORLD = (() => {
  const world = new Array(BONES.length);
  BONES.forEach((b, i) => {
    const local = Mat4.fromRotationTranslation(BIND_LOCAL[i].rot, BIND_LOCAL[i].pos);
    world[i] = b.parent < 0 ? local : Mat4.multiply(world[b.parent], local);
  });
  return world;
})();

export const INV_BIND = BIND_WORLD.map((m) => Mat4.invertRigid(m));

// Bind-pose bone segment lengths (used by the validator to detect collapse).
export const BIND_LENGTHS = BONES.map((b) =>
  b.parent < 0 ? 0 : Vec3.length(Vec3.sub(b.bindPos, BONES[b.parent].bindPos)));

// A pose is { rot: quat[17], rootPos: vec3 } — local rotations per bone plus
// the world-space hips translation (the only translated joint).
export function bindPose() {
  return {
    rot: BONES.map(() => Quat.identity()),
    rootPos: BONES[0].bindPos.slice(),
  };
}

// Sample one animation clip at a (looping) time. Clip tracks map bone name
// to keyframe arrays [{ t, q }]; 'rootPos' holds vec3 offset keys.
export function sampleClip(clip, time) {
  const pose = bindPose();
  const t = clip.duration > 0 ? time % clip.duration : 0;
  for (const [name, keys] of Object.entries(clip.tracks)) {
    if (name === 'rootPos') {
      const off = sampleVecTrack(keys, t);
      pose.rootPos = Vec3.add(BONES[0].bindPos, off);
      continue;
    }
    const idx = boneIndex(name);
    if (idx < 0) continue;
    pose.rot[idx] = sampleQuatTrack(keys, t);
  }
  return pose;
}

function findKeys(keys, t) {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[(i + 1) % keys.length];
  const span = (b.t > a.t ? b.t : b.t + keys[keys.length - 1].t) - a.t || 1;
  return [a, b, Math.min(1, Math.max(0, (t - a.t) / span))];
}

function sampleQuatTrack(keys, t) {
  const [a, b, f] = findKeys(keys, t);
  return Quat.slerp(a.q, b.q, f);
}

function sampleVecTrack(keys, t) {
  const [a, b, f] = findKeys(keys, t);
  return Vec3.lerp(a.v, b.v, f);
}

// Crossfade two poses. Rotations are nlerp'd per bone (constant bone length
// is preserved, so joints cannot collapse), root translation is lerped.
export function blendPoses(a, b, f) {
  return {
    rot: a.rot.map((q, i) => Quat.nlerp(q, b.rot[i], f)),
    rootPos: Vec3.lerp(a.rootPos, b.rootPos, f),
  };
}

// World matrices: hierarchical propagation world[c] = world[p] * local(c).
export function computeWorldMatrices(pose) {
  const world = new Array(BONE_COUNT);
  for (let i = 0; i < BONE_COUNT; i++) {
    const pos = i === 0 ? pose.rootPos : BIND_LOCAL[i].pos;
    const local = Mat4.fromRotationTranslation(pose.rot[i], pos);
    const p = BONES[i].parent;
    world[i] = p < 0 ? local : Mat4.multiply(world[p], local);
  }
  return world;
}

// Final skinning palette uploaded to the GPU: world * inverseBind.
export function computeBoneMatrices(world) {
  return world.map((m, i) => Mat4.multiply(m, INV_BIND[i]));
}

export function flattenMatrices(mats) {
  const out = new Float32Array(mats.length * 16);
  mats.forEach((m, i) => out.set(m, i * 16));
  return out;
}
