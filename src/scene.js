// Scene geometry: ground, pillars, back wall, and a fan whose blades spin
// (local object motion, distinct from camera motion).
import { M4 } from './gl.js';

function pushBox(arr, cx, cy, cz, sx, sy, sz, color) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const f = (n, a, b, c, d) => {
    for (const p of [a, b, c, a, c, d]) {
      arr.pos.push(...p); arr.nrm.push(...n); arr.col.push(...color);
    }
  };
  f([0, 0, 1], [x0,y0,z1], [x1,y0,z1], [x1,y1,z1], [x0,y1,z1]);
  f([0, 0,-1], [x1,y0,z0], [x0,y0,z0], [x0,y1,z0], [x1,y1,z0]);
  f([1, 0, 0], [x1,y0,z1], [x1,y0,z0], [x1,y1,z0], [x1,y1,z1]);
  f([-1,0, 0], [x0,y0,z0], [x0,y0,z1], [x0,y1,z1], [x0,y1,z0]);
  f([0, 1, 0], [x0,y1,z1], [x1,y1,z1], [x1,y1,z0], [x0,y1,z0]);
  f([0,-1, 0], [x0,y0,z0], [x1,y0,z0], [x1,y0,z1], [x0,y0,z1]);
}

function makeMesh(gl, arr) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = (loc, data) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  };
  buf(0, arr.pos); buf(1, arr.nrm); buf(2, arr.col);
  gl.bindVertexArray(null);
  return { vao, count: arr.pos.length / 3 };
}

export function buildScene(gl) {
  const objects = [];
  const add = (arr, id, modelFn) => {
    objects.push({ mesh: makeMesh(gl, arr), id, modelFn, prevModel: M4.ident() });
  };

  // ground
  const g = { pos: [], nrm: [], col: [] };
  pushBox(g, 0, -0.05, 0, 30, 0.1, 30, [0.23, 0.25, 0.28]);
  add(g, 0, () => M4.ident());

  // pillars (give the camera pan something to occlude/disocclude)
  const p = { pos: [], nrm: [], col: [] };
  pushBox(p, -3.2, 1.5, -2.0, 0.6, 3.0, 0.6, [0.55, 0.36, 0.28]);
  pushBox(p, -0.6, 1.1, -3.5, 0.8, 2.2, 0.8, [0.30, 0.44, 0.55]);
  pushBox(p, 3.4, 1.8, -1.5, 0.5, 3.6, 0.5, [0.50, 0.50, 0.34]);
  add(p, 0, () => M4.ident());

  // back wall
  const w = { pos: [], nrm: [], col: [] };
  pushBox(w, 0, 2.0, -6.0, 24, 4.0, 0.3, [0.36, 0.38, 0.44]);
  add(w, 0, () => M4.ident());

  // fan stand + hub (static, id 0)
  const s = { pos: [], nrm: [], col: [] };
  pushBox(s, 0, -0.85, 0, 0.12, 1.3, 0.12, [0.20, 0.20, 0.22]);
  pushBox(s, 0, 0, 0, 0.22, 0.22, 0.16, [0.65, 0.65, 0.68]);
  const fanBase = M4.translate(1.6, 1.5, -1.0);
  add(s, 0, () => fanBase);

  // fan blades (spinning, id 1): three blades rotating about local Z
  const b = { pos: [], nrm: [], col: [] };
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3;
    const tmp = { pos: [], nrm: [], col: [] };
    pushBox(tmp, 0.535, 0, 0, 0.83, 0.18, 0.04, [0.85, 0.30, 0.20]);
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i < tmp.pos.length; i += 3) {
      const x = tmp.pos[i], y = tmp.pos[i + 1];
      b.pos.push(x * ca - y * sa, x * sa + y * ca, tmp.pos[i + 2]);
      const nx = tmp.nrm[i], ny = tmp.nrm[i + 1];
      b.nrm.push(nx * ca - ny * sa, nx * sa + ny * ca, tmp.nrm[i + 2]);
      b.col.push(tmp.col[i], tmp.col[i + 1], tmp.col[i + 2]);
    }
  }
  const spin = { angle: 0 };
  const bladeObj = {
    mesh: makeMesh(gl, b), id: 1,
    modelFn: () => M4.mul(fanBase, M4.rotZ(spin.angle)),
    prevModel: M4.ident(),
  };
  objects.push(bladeObj);

  return {
    objects,
    // advance animation by one fixed step
    tick(scenario, frame) {
      if (scenario === 'fan') spin.angle += 0.35; // fast spin
      else spin.angle += 0.0;
    },
    camera(scenario, frame) {
      let x = 0;
      if (scenario === 'pan') x = -3.0 + frame * 0.28; // fast lateral move
      return { eye: [x, 1.6, 6.0], at: [x, 1.3, 0.0], up: [0, 1, 0] };
    },
    fanWorldPos: [1.6, 1.5, -1.0],
  };
}
