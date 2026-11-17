// Deterministic scene + camera paths shared by the UI and the verifier.
import { vec3, makeObject, moveObject, Octree, aabb } from './octree.js';

export const ROOT_BOX = aabb(vec3(-64, -16, -64), vec3(64, 16, 64));

// Small deterministic PRNG (mulberry32).
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildScene(seed = 20261118) {
  const rand = rng(seed);
  const statics = [];
  for (let i = 0; i < 400; i++) {
    const center = vec3(
      -60 + rand() * 120,
      -12 + rand() * 24,
      -60 + rand() * 120
    );
    const h = 0.5 + rand() * 1.5;
    statics.push(makeObject(center, vec3(h, h, h)));
  }
  const dynamics = [];
  for (let i = 0; i < 12; i++) {
    const center = vec3(-50 + rand() * 100, -8 + rand() * 16, -50 + rand() * 100);
    const obj = makeObject(center, vec3(1, 1, 1), true);
    obj.orbit = {
      radius: 6 + rand() * 14,
      speed: 0.4 + rand() * 0.8,
      phase: rand() * Math.PI * 2,
      home: center,
    };
    dynamics.push(obj);
  }

  const tree = new Octree(ROOT_BOX);
  for (const obj of statics) tree.insertStatic(obj);
  tree.finalizeStatic();

  return { tree, statics, dynamics };
}

// Advance dynamic objects and put them back into the index for this frame.
export function updateDynamics(scene, t) {
  scene.tree.clearDynamic();
  for (const obj of scene.dynamics) {
    const o = obj.orbit;
    moveObject(obj, vec3(
      o.home.x + Math.cos(t * o.speed + o.phase) * o.radius,
      o.home.y + Math.sin(t * o.speed * 0.7 + o.phase) * 3,
      o.home.z + Math.sin(t * o.speed + o.phase) * o.radius
    ));
    scene.tree.reinsertDynamic(obj);
  }
}

const ASPECT = 16 / 9;

// Three camera paths. Each returns an array of frustum parameter sets.
export function buildCameraPaths() {
  const paths = [];

  // 1. Wide angle: slow orbit around the scene, fov 100 deg.
  const wide = { name: 'wide', label: '广角环绕 (FOV 100°)', frames: [] };
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    wide.frames.push({
      position: vec3(Math.cos(a) * 90, 30, Math.sin(a) * 90),
      target: vec3(0, 0, 0),
      fovYDeg: 100, aspect: ASPECT, near: 1, far: 300,
    });
  }
  paths.push(wide);

  // 2. Narrow angle: panning sweep across the scene, fov 25 deg.
  const narrow = { name: 'narrow', label: '窄角扫视 (FOV 25°)', frames: [] };
  for (let i = 0; i < 60; i++) {
    const a = -0.9 + (i / 59) * 1.8;
    narrow.frames.push({
      position: vec3(0, 20, 110),
      target: vec3(Math.sin(a) * 100, 0, 110 - Math.cos(a) * 100),
      fovYDeg: 25, aspect: ASPECT, near: 1, far: 300,
    });
  }
  paths.push(narrow);

  // 3. Camera travels through the octree boundary, looking back at the scene.
  const cross = { name: 'cross', label: '穿过树边界 (内部 -> 外部)', frames: [] };
  for (let i = 0; i < 60; i++) {
    const d = -40 + (i / 59) * 160; // from inside the root box to far outside
    cross.frames.push({
      position: vec3(d, 8, d * 0.5),
      target: vec3(0, 0, 0),
      fovYDeg: 60, aspect: ASPECT, near: 1, far: 300,
    });
  }
  paths.push(cross);

  return paths;
}
