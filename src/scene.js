import { sphere, box, torus, plane } from './geometry.js';
import { compose, lookAt, perspective } from './mat4.js';

export const meshes = {
  sphere: sphere(),
  box: box(1),
  torus: torus(),
  ground: plane(24),
};

// albedo in linear-ish 0..1; roughness 0..1; transparent objects never enter
// the opaque G-Buffer (see renderer pass order).
export const opaqueObjects = [
  { mesh: 'ground', model: compose([0, -1.0, 0], 0, [1, 1, 1]),
    albedo: [0.32, 0.30, 0.28], roughness: 0.85 },
  { mesh: 'sphere', model: compose([-1.7, -0.1, 0.6], 0, [0.9, 0.9, 0.9]),
    albedo: [0.85, 0.22, 0.18], roughness: 0.15 },           // glossy red sphere
  { mesh: 'box', model: compose([0.9, -0.35, -0.9], 0.5, [1.3, 1.3, 1.3]),
    albedo: [0.20, 0.45, 0.85], roughness: 0.55 },           // blue cube behind
  { mesh: 'sphere', model: compose([0.15, -0.55, 1.5], 0, [0.45, 0.45, 0.45]),
    albedo: [0.95, 0.85, 0.35], roughness: 0.35 },           // small yellow sphere front
  { mesh: 'torus', model: compose([1.9, 0.25, 1.1], 0.9, [0.8, 0.8, 0.8]),
    albedo: [0.35, 0.8, 0.45], roughness: 0.08 },            // green glossy torus
  { mesh: 'box', model: compose([-0.6, -0.85, -2.2], -0.3, [0.6, 0.6, 0.6]),
    albedo: [0.75, 0.55, 0.85], roughness: 0.95 },           // matte purple, far
  { mesh: 'sphere', model: compose([-1.7, 0.95, -0.5], 0, [0.4, 0.4, 0.4]),
    albedo: [0.15, 0.15, 0.2], roughness: 0.25 },            // dark sphere peeking behind the red one
];

// Three glass shards at different depths, deliberately overlapping in screen
// space: correct output needs back-to-front sorting, not submission order.
export const transparentObjects = [
  { mesh: 'box', model: compose([0.6, 0.05, 3.2], 0.4, [1.5, 1.5, 0.12]),
    albedo: [0.4, 0.8, 1.0], roughness: 0.05, opacity: 0.35 },
  { mesh: 'box', model: compose([0.1, 0.15, 1.9], -0.25, [1.4, 1.4, 0.12]),
    albedo: [1.0, 0.55, 0.6], roughness: 0.05, opacity: 0.3 },
  { mesh: 'box', model: compose([-0.4, 0.25, 0.7], 0.15, [1.3, 1.3, 0.12]),
    albedo: [0.7, 1.0, 0.6], roughness: 0.05, opacity: 0.28 },
];

export const light = {
  dir: normalize([-0.45, 0.8, 0.4]),
  color: [1.0, 0.96, 0.88],
  intensity: 2.2,
  ambient: [0.16, 0.18, 0.22],
};

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function makeCamera(width, height) {
  const eye = [0, 1.1, 5.2];
  const view = lookAt(eye, [0, -0.15, 0], [0, 1, 0]);
  const proj = perspective(Math.PI / 4.5, width / height, 0.1, 60);
  return { eye, view, proj };
}
