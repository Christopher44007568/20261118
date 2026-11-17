// Scene: triangle soup built from quads/boxes. Units in meters.
"use strict";

// A mesh is { name, tris: Float64Array-like flat [ax,ay,az,bx,...,cx,cy,cz]*n, color:[r,g,b], dynamic:bool }
function quad(a, b, c, d) {
  // two triangles a-b-c, a-c-d
  return [...a, ...b, ...c, ...a, ...c, ...d];
}

function box(cx, cy, cz, sx, sy, sz) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const p = {
    nnn: [x0, y0, z0], nnp: [x0, y0, z1], npn: [x0, y1, z0], npp: [x0, y1, z1],
    pnn: [x1, y0, z0], pnp: [x1, y0, z1], ppn: [x1, y1, z0], ppp: [x1, y1, z1],
  };
  return [
    ...quad(p.npn, p.npp, p.ppp, p.ppn), // top (+y)
    ...quad(p.nnn, p.pnn, p.pnp, p.nnp), // bottom (-y)
    ...quad(p.nnn, p.nnp, p.npp, p.npn), // -x
    ...quad(p.pnn, p.ppn, p.ppp, p.pnp), // +x
    ...quad(p.nnp, p.pnp, p.ppp, p.npp), // +z
    ...quad(p.nnn, p.npn, p.ppn, p.pnn), // -z
  ];
}

function ground(size, y = 0) {
  const h = size / 2;
  return quad([-h, y, -h], [-h, y, h], [h, y, h], [h, y, -h]); // +y normal
}

// Build the demo scene. `moverX` is the current x of the "static" crate that
// gets relocated between frames (its depth-moment texture must be refreshed).
function buildScene(moverX) {
  return [
    { name: "ground", tris: ground(30, 0), color: [0.72, 0.70, 0.66], dynamic: false },
    // Tall occluder casting a long directional shadow.
    { name: "pillar", tris: box(-2.2, 1.5, -1.0, 1.2, 3.0, 1.2), color: [0.62, 0.44, 0.34], dynamic: false },
    // Thin slab hovering just above the ground: classic light-bleeding setup
    // (occluder and receiver depths are very close in light space).
    { name: "slab", tris: box(1.6, 0.33, 1.2, 2.6, 0.06, 2.6), color: [0.36, 0.52, 0.62], dynamic: false },
    // Small cube for the spotlight to play on.
    { name: "cube", tris: box(-0.4, 0.45, 2.6, 0.9, 0.9, 0.9), color: [0.55, 0.58, 0.38], dynamic: false },
    // "Static" crate that the app moves at runtime -> moment texture update.
    { name: "mover", tris: box(moverX, 0.6, -2.6, 1.2, 1.2, 1.2), color: [0.66, 0.52, 0.30], dynamic: true },
  ];
}

module.exports = { buildScene };
