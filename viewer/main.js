// Catmull-Clark WebAssembly viewer: WebGL rendering + UI controls.
'use strict';

const state = {
  engine: null, mesh: null, cage: null,
  level: 2, meshKind: 'cube',
  showSurface: true, showCage: true, showNormals: false,
  rotX: -0.5, rotY: 0.6, dist: 5.0,
};

// ---- wasm engine ----------------------------------------------------------

async function loadEngine() {
  const resp = await fetch('../build/catmull_clark.wasm');
  const bytes = await resp.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;
  return {
    ex,
    reset: () => ex.cc_reset(),
    addVertex: (x, y, z) => ex.cc_add_vertex(x, y, z),
    addFace: (vs) => { ex.cc_begin_face(); vs.forEach((v) => ex.cc_add_face_vertex(v)); ex.cc_end_face(); },
    subdivide: () => ex.cc_subdivide(),
    readMesh() {
      const nv = ex.cc_num_vertices();
      const nf = ex.cc_num_faces();
      const positions = new Float32Array(ex.memory.buffer, ex.cc_positions(), nv * 3).slice();
      const offsets = new Int32Array(ex.memory.buffer, ex.cc_face_offsets(), nf + 1).slice();
      const corners = new Int32Array(ex.memory.buffer, ex.cc_face_verts(), offsets[nf]).slice();
      const faces = [];
      for (let f = 0; f < nf; f++) faces.push(Array.from(corners.slice(offsets[f], offsets[f + 1])));
      return { positions, faces };
    },
    faceNormal: (f) => Array.from(new Float32Array(ex.memory.buffer, ex.cc_face_normal(f), 3)),
    faceArea: (f) => ex.cc_face_area(f),
    totalArea: () => ex.cc_total_area(),
  };
}

// ---- control meshes -------------------------------------------------------

function buildCube(e) {
  e.reset();
  [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]
    .forEach((p) => e.addVertex(...p));
  [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]].forEach((f) => e.addFace(f));
}

function buildPlane(e) {
  e.reset();
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) e.addVertex(x - 1, y - 1, 0);
  [[0,1,4],[0,4,3],[1,2,5,4],[3,4,6],[4,7,6],[4,5,8,7]].forEach((f) => e.addFace(f));
}

function rebuild() {
  const e = state.engine;
  if (state.meshKind === 'cube') buildCube(e); else buildPlane(e);
  state.cage = e.readMesh();
  for (let i = 0; i < state.level; i++) e.subdivide();
  state.mesh = e.readMesh();
  updateStats();
  uploadGeometry();
  draw();
}

// ---- stats panel ----------------------------------------------------------

function updateStats() {
  const e = state.engine;
  const m = state.mesh;
  const nf = m.faces.length;
  let minA = Infinity, maxA = 0;
  const rows = [];
  for (let f = 0; f < nf; f++) {
    const a = e.faceArea(f);
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    if (f < 60) rows.push([f, e.faceNormal(f), a]);
  }
  document.getElementById('summary').innerHTML = [
    `顶点: ${m.positions.length / 3}`, `面: ${nf}`,
    `总面积: ${e.totalArea().toFixed(6)}`,
    `面面积: [${minA.toFixed(6)}, ${maxA.toFixed(6)}]`,
  ].map((s) => `<div class="stat">${s}</div>`).join('');
  let html = '<tr><th>面</th><th>法线</th><th>面积</th></tr>';
  for (const [f, n, a] of rows) {
    html += `<tr><td>${f}</td><td>(${n.map((x) => x.toFixed(2)).join(', ')})</td><td>${a.toFixed(5)}</td></tr>`;
  }
  if (nf > rows.length) html += `<tr><td colspan="3">… 共 ${nf} 面, 仅显示前 ${rows.length} 行</td></tr>`;
  document.getElementById('faceTable').innerHTML = html;
}

// ---- WebGL ----------------------------------------------------------------

let gl, prog, lineProg;
let surfBuf = null, surfCount = 0;
let cageBuf = null, cageCount = 0;
let normBuf = null, normCount = 0;

const VS = `
attribute vec3 aPos; attribute vec3 aNrm;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec3 vNrm;
void main() { vNrm = mat3(uModel) * aNrm; gl_Position = uMVP * vec4(aPos, 1.0); }`;
const FS = `
precision mediump float; varying vec3 vNrm;
void main() {
  vec3 n = normalize(vNrm);
  float d = 0.35 + 0.65 * abs(dot(n, normalize(vec3(0.4, 0.7, 0.6))));
  gl_FragColor = vec4(vec3(0.55, 0.7, 0.95) * d, 1.0);
}`;
const LVS = `
attribute vec3 aPos; uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`;
const LFS = `
precision mediump float; uniform vec3 uColor;
void main() { gl_FragColor = vec4(uColor, 1.0); }`;

function makeProgram(vsSrc, fsSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  return p;
}

function initGL() {
  const canvas = document.getElementById('gl');
  gl = canvas.getContext('webgl');
  prog = makeProgram(VS, FS);
  lineProg = makeProgram(LVS, LFS);
  gl.enable(gl.DEPTH_TEST);
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  const canvas = document.getElementById('gl');
  canvas.width = window.innerWidth - 300;
  canvas.height = window.innerHeight;
  canvas.style.width = canvas.width + 'px';
  canvas.style.height = canvas.height + 'px';
  gl.viewport(0, 0, canvas.width, canvas.height);
  draw();
}

function meshToTriangles(mesh) {
  // fan-triangulate faces, flat normals per face
  const out = [];
  const p = mesh.positions;
  for (const face of mesh.faces) {
    const n = faceNormalJS(mesh, face);
    const v0 = face[0];
    for (let i = 1; i + 1 < face.length; i++) {
      for (const v of [v0, face[i], face[i + 1]]) {
        out.push(p[3 * v], p[3 * v + 1], p[3 * v + 2], ...n);
      }
    }
  }
  return new Float32Array(out);
}

function faceNormalJS(mesh, face) {
  const p = mesh.positions;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length];
    nx += (p[3*a+1] - p[3*b+1]) * (p[3*a+2] + p[3*b+2]);
    ny += (p[3*a+2] - p[3*b+2]) * (p[3*a] + p[3*b]);
    nz += (p[3*a] - p[3*b]) * (p[3*a+1] + p[3*b+1]);
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function meshEdges(mesh) {
  const seen = new Set();
  const out = [];
  const p = mesh.positions;
  for (const face of mesh.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const key = a < b ? a + ',' + b : b + ',' + a;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p[3*a], p[3*a+1], p[3*a+2], p[3*b], p[3*b+1], p[3*b+2]);
    }
  }
  return new Float32Array(out);
}

function normalLines(mesh) {
  const out = [];
  const p = mesh.positions;
  for (const face of mesh.faces) {
    let cx = 0, cy = 0, cz = 0;
    for (const v of face) { cx += p[3*v]; cy += p[3*v+1]; cz += p[3*v+2]; }
    const inv = 1 / face.length;
    const n = faceNormalJS(mesh, face);
    const s = 0.12;
    out.push(cx*inv, cy*inv, cz*inv, cx*inv + n[0]*s, cy*inv + n[1]*s, cz*inv + n[2]*s);
  }
  return new Float32Array(out);
}

function makeBuffer(data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buf;
}

function uploadGeometry() {
  const tri = meshToTriangles(state.mesh);
  surfBuf = makeBuffer(tri);
  surfCount = tri.length / 6;
  const cage = meshEdges(state.cage);
  cageBuf = makeBuffer(cage);
  cageCount = cage.length / 3;
  const nl = normalLines(state.mesh);
  normBuf = makeBuffer(nl);
  normCount = nl.length / 3;
}

// ---- camera / draw ----------------------------------------------------------

function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f;
  o[10] = (far + near) / (near - far); o[11] = -1;
  o[14] = 2 * far * near / (near - far);
  return o;
}

function viewMatrix() {
  const cx = Math.cos(state.rotX), sx = Math.sin(state.rotX);
  const cy = Math.cos(state.rotY), sy = Math.sin(state.rotY);
  // rotate then translate back
  const rot = new Float32Array([
    cy, sx * sy, -cx * sy, 0,
    0, cx, sx, 0,
    sy, -sx * cy, cx * cy, 0,
    0, 0, 0, 1,
  ]);
  const tr = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-state.dist,1]);
  return mat4Mul(tr, rot);
}

function draw() {
  if (!gl || !state.mesh) return;
  gl.clearColor(0.11, 0.12, 0.14, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const aspect = gl.canvas.width / gl.canvas.height;
  const mvp = mat4Mul(perspective(Math.PI / 4, aspect, 0.1, 100), viewMatrix());
  const ident = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

  if (state.showSurface) {
    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMVP'), false, mvp);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uModel'), false, ident);
    gl.bindBuffer(gl.ARRAY_BUFFER, surfBuf);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aNrm = gl.getAttribLocation(prog, 'aNrm');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aNrm);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, surfCount);
  }

  const drawLines = (buf, count, color) => {
    gl.useProgram(lineProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(lineProg, 'uMVP'), false, mvp);
    gl.uniform3fv(gl.getUniformLocation(lineProg, 'uColor'), color);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const aPos = gl.getAttribLocation(lineProg, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 12, 0);
    gl.drawArrays(gl.LINES, 0, count);
  };
  if (state.showCage) drawLines(cageBuf, cageCount, [1.0, 0.6, 0.15]);
  if (state.showNormals) drawLines(normBuf, normCount, [0.2, 1.0, 0.4]);
}

// ---- interaction ------------------------------------------------------------

function initUI() {
  const canvas = document.getElementById('gl');
  let dragging = false, px = 0, py = 0;
  canvas.addEventListener('mousedown', (e) => { dragging = true; px = e.clientX; py = e.clientY; });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    state.rotY += (e.clientX - px) * 0.01;
    state.rotX += (e.clientY - py) * 0.01;
    px = e.clientX; py = e.clientY;
    draw();
  });
  canvas.addEventListener('wheel', (e) => {
    state.dist = Math.min(30, Math.max(1.5, state.dist * (1 + e.deltaY * 0.001)));
    draw();
  });
  document.getElementById('meshSel').addEventListener('change', (e) => {
    state.meshKind = e.target.value; rebuild();
  });
  document.getElementById('level').addEventListener('input', (e) => {
    state.level = +e.target.value;
    document.getElementById('levelVal').textContent = e.target.value;
    rebuild();
  });
  document.getElementById('showSurface').addEventListener('change', (e) => { state.showSurface = e.target.checked; draw(); });
  document.getElementById('showCage').addEventListener('change', (e) => { state.showCage = e.target.checked; draw(); });
  document.getElementById('showNormals').addEventListener('change', (e) => { state.showNormals = e.target.checked; draw(); });
}

(async function main() {
  state.engine = await loadEngine();
  initGL();
  initUI();
  rebuild();
})();
