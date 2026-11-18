// Procedural Cornell-box style scene:
//  - 6 axis-aligned boxes form the room
//  - 5 spheres covering diffuse / metal / rough glossy materials
//  - 1 rectangular quad area light on the ceiling
//
// Sphere layout: [cx, cy, cz, radius]
// Material:      { albedo:[r,g,b], metallic, roughness, emission, kind }

export const MAT = { DIFFUSE: 0, METAL: 1, GLOSSY: 2 };

function mat(albedo, metallic, roughness, emission = 0, kind = MAT.DIFFUSE) {
  return { albedo, metallic, roughness, emission, kind };
}

export function buildScene() {
  const spheres = [
    // Red matte diffuse sphere, back-left (diffuse reference)
    { c: [-1.95, 0.75, -2.3], r: 0.75, m: mat([0.74, 0.09, 0.09], 0.0, 0.95, 0, MAT.DIFFUSE) },
    // Gold polished metal, front-left
    { c: [-1.5, 0.7, 0.9], r: 0.7, m: mat([0.86, 0.62, 0.25], 1.0, 0.08, 0, MAT.METAL) },
    // Black chrome metal, center
    { c: [0.25, 0.85, -0.5], r: 0.85, m: mat([0.72, 0.72, 0.75], 1.0, 0.03, 0, MAT.METAL) },
    // Rough glossy (high-roughness dielectric), front-right
    { c: [1.75, 0.75, 0.8], r: 0.75, m: mat([0.36, 0.22, 0.72], 0.0, 0.38, 0, MAT.GLOSSY) },
    // Small polished silver sphere, back-right
    { c: [2.15, 0.6, -2.2], r: 0.6, m: mat([0.92, 0.94, 0.96], 1.0, 0.12, 0, MAT.METAL) },
  ];

  const wall = (min, max, color) => ({
    min, max, m: mat(color, 0.0, 1.0, 0, MAT.DIFFUSE),
  });

  const boxes = [
    wall([-4.01, -0.01, -4.51], [-3.99, 4.01, 4.01], [0.72, 0.09, 0.09]), // left red
    wall([3.99, -0.01, -4.51], [4.01, 4.01, 4.01], [0.08, 0.16, 0.72]),   // right blue
    wall([-4.01, -0.02, -4.52], [4.01, 0.0, 4.01], [0.78, 0.74, 0.62]),   // floor cream
    wall([-4.01, 3.99, -4.52], [4.01, 4.02, 4.01], [0.82, 0.82, 0.80]),   // ceiling
    wall([-4.01, -0.01, -4.52], [4.01, 4.02, -4.49], [0.74, 0.72, 0.64]), // back
    wall([-4.01, -0.01, 3.99], [4.01, 4.02, 4.02], [0.70, 0.68, 0.60]),   // front (behind camera)
  ];

  // Ceiling quad light, centered around x = 0.5, z = -1.0
  const light = {
    origin: [-0.7, 3.97, -2.2],
    edgeU: [2.4, 0.0, 0.0],
    edgeV: [0.0, 0.0, 2.4],
    normal: [0.0, -1.0, 0.0],
    half: [1.2, 1.2],
    power: 14.0,
    color: [1.0, 0.96, 0.88],
  };

  return { spheres, boxes, lights: [light] };
}

// Orbit camera targeting the middle of the room.
export function makeCamera() {
  return {
    target: [0.0, 1.0, -1.0],
    yaw: 0.0,
    pitch: 0.12,
    distance: 3.9,
    fovY: (66 * Math.PI) / 180,
  };
}

export function cameraFrame(cam, width, height) {
  const cp = Math.cos(cam.pitch);
  const dir = [
    Math.sin(cam.yaw) * cp,
    Math.sin(cam.pitch),
    -Math.cos(cam.yaw) * cp,
  ];
  const origin = [
    cam.target[0] - dir[0] * cam.distance,
    cam.target[1] - dir[1] * cam.distance,
    cam.target[2] - dir[2] * cam.distance,
  ];
  const up = [0, 1, 0];
  const right = normalize(cross(dir, up));
  const down = scale(cross(right, dir), -1);
  const aspect = width / height;
  const halfH = Math.tan(cam.fovY / 2);
  const halfW = halfH * aspect;
  const center = add(origin, dir);
  const topLeft = add(
    add(center, scale(right, -halfW)),
    scale(down, -halfH)
  );
  const rightStep = scale(right, (2 * halfW) / width);
  const downStep = scale(down, (2 * halfH) / height);
  return { origin, topLeft, right: rightStep, down: downStep };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
