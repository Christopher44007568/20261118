import { makePlane, makeSphere, makeBox, makeCloth } from './meshes.js';

// Fixed scene containing all four required regions:
// corner (two walls meet), sphere/floor contact, a thin plate and a flat wall.
// A curved "cloth" grid additionally proves normals come from real geometry.
export function buildScene() {
  const objects = [
    {
      id: 'floor',
      mesh: makePlane(16, 12, 64, 48),
      model: translation(0, 0, 0),
      albedo: [0.62, 0.66, 0.7]
    },
    {
      id: 'wallBack',
      mesh: makePlane(16, 5, 64, 20),
      model: mult(translation(0, 2.5, -4), rotationX(Math.PI / 2)),
      albedo: [0.72, 0.7, 0.66]
    },
    {
      id: 'wallLeft',
      mesh: makePlane(8, 5, 32, 20),
      model: mult(translation(-6, 2.5, 0), rotationZ(-Math.PI / 2)),
      albedo: [0.68, 0.72, 0.74]
    },
    {
      id: 'sphere',
      mesh: makeSphere(0.9, 48, 48),
      model: translation(-2.6, 0.9, -2.2),
      albedo: [0.8, 0.55, 0.35]
    },
    {
      // Thin horizontal plate hovering above the floor: both edges must
      // produce occlusion without the slab being treated as a solid wall.
      id: 'thinPlate',
      mesh: makeBox(2.4, 0.12, 1.4),
      model: translation(1.6, 1.1, -1.6),
      albedo: [0.55, 0.65, 0.8]
    },
    {
      id: 'cloth',
      mesh: makeCloth(3.2, 2.6, 48, 40),
      model: translation(3.4, 1.25, 1.4),
      albedo: [0.78, 0.45, 0.55]
    }
  ];

  // World-space anchors used by the test harness to locate each region.
  const probes = {
    corner: [-5.85, 0.08, -3.85],          // floor next to the wall corner
    sphereContact: [-1.75, 0.04, -2.2],    // contact ring at the sphere/floor edge
    thinPlate: [1.6, 1.02, -1.6],          // just below the plate edge
    flatWall: [0.0, 3.2, -3.96],           // center of the back wall, far from edges
    cloth: [3.4, 1.45, 1.4]                // curved cloth surface
  };

  return { objects, probes };
}

function translation(x, y, z) {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function rotationX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = new Float32Array(16);
  m[0] = 1; m[5] = c; m[6] = s; m[9] = -s; m[10] = c; m[15] = 1;
  return m;
}

function rotationZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = new Float32Array(16);
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c; m[10] = 1; m[15] = 1;
  return m;
}

function mult(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}
