// WebGL2 demo: renders the compressed stream, reconstructs attributes in the
// vertex shader, and offers original/decoded/error-heatmap visualization.

import { VERT_SRC, FRAG_SRC } from './shaders.js';
import {
  compressMesh, decompressMesh, sourceByteCount, compressedByteCount,
} from './compress.js';
import { analyze, frameOrthonormalError } from './stats.js';

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT_SRC));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p));
  }
  return p;
}

function makeVao(gl, mesh, packed) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, packed.bytes, gl.STATIC_DRAW);
  const s = packed.stride;
  // 3 x UNORM16 position
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, true, s, 0);
  // 2 x SNORM8 octahedron
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2,
    packed.mode === 'oct32' ? gl.SHORT : gl.BYTE, true, s, 6);
  // 2 x UNORM16 uv
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.UNSIGNED_SHORT, true, s,
    packed.mode === 'oct32' ? 10 : 8);
  // handedness sign (one byte, normalized to [-1,+1])
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.BYTE, true, s, packed.mode === 'oct32' ? 14 : 12);
  const ref = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ref);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 0, 0);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, indexCount: mesh.indices.length };
}

export function startDemo(canvas, meshes, { mode = 'oct16' } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  const prog = program(gl);
  gl.useProgram(prog);
  const loc = {
    min: gl.getUniformLocation(prog, 'uAabbMin'),
    max: gl.getUniformLocation(prog, 'uAabbMax'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    light: gl.getUniformLocation(prog, 'uLightDir'),
    mode: gl.getUniformLocation(prog, 'uMode'),
    heatMetric: gl.getUniformLocation(prog, 'uHeatMetric'),
    heatMax: gl.getUniformLocation(prog, 'uHeatMax'),
  };

  const state = {
    meshIndex: 0, mode, viewMode: 0, heatMetric: 0,
    packed: null, mesh: null, stats: null,
  };

  function loadMesh(index) {
    state.meshIndex = index;
    const mesh = meshes[index];
    const packed = compressMesh(mesh, { mode: state.mode });
    packed.indices = mesh.indices;
    packed.indexCount = mesh.indices.length;
    const decoded = decompressMesh(mesh, packed);
    state.mesh = mesh;
    state.packed = packed;
    state.decoded = decoded;
    state.stats = analyze(mesh, decoded, packed);
    state.stats.frameOrthonormalError = frameOrthonormalError(decoded);
    state.vao = makeVao(gl, mesh, packed);
    state.bytes = {
      source: sourceByteCount(packed.vertexCount),
      compressed: compressedByteCount(packed),
    };
  }

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  }
  function lookAt(eye, center, up) {
    const z = norm(sub(eye, center));
    const x = norm(cross(up, z));
    const y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
    ]);
  }
  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0] + a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] + a[3 * 4 + r] * b[c * 4 + 3];
    }
    return o;
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  let yaw = 0.6, pitch = 0.35, distScale = 2.4;
  function frame() {
    const { mesh, packed, stats } = state;
    const c = [(mesh.aabb.min[0] + mesh.aabb.max[0]) / 2,
      (mesh.aabb.min[1] + mesh.aabb.max[1]) / 2,
      (mesh.aabb.min[2] + mesh.aabb.max[2]) / 2];
    const diag = stats.bboxDiagonal || 1;
    const dist = diag * distScale;
    const eye = [
      c[0] + dist * Math.cos(pitch) * Math.sin(yaw),
      c[1] + dist * Math.sin(pitch),
      c[2] + dist * Math.cos(pitch) * Math.cos(yaw),
    ];
    const aspect = canvas.width / canvas.height;
    const vp = mul(perspective(Math.PI / 4, aspect, diag * 1e-4, diag * 200),
      lookAt(eye, c, [0, 1, 0]));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.06, 0.07, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.uniform3fv(loc.min, mesh.aabb.min);
    gl.uniform3fv(loc.max, mesh.aabb.max);
    gl.uniformMatrix4fv(loc.viewProj, false, vp);
    gl.uniform3f(loc.light, 0.4, 0.7, 0.55);
    gl.uniform1i(loc.heatMetric, state.heatMetric);
    gl.uniform1f(loc.heatMax, state.heatMetric === 0
      ? Math.max(stats.normal.maxAngleDeg, 1e-3)
      : Math.max(stats.color.maxRgbDistance, 1e-3));

    // Two viewports: left original, right decoded/heat.
    const half = Math.floor(canvas.width / 2);
    gl.bindVertexArray(state.vao.vao);
    // left: original shading (uses reference normals)
    gl.scissor(0, 0, half, canvas.height);
    gl.viewport(0, 0, half, canvas.height);
    gl.uniform1i(loc.mode, 0);
    gl.drawElements(gl.TRIANGLES, state.vao.indexCount, gl.UNSIGNED_INT, 0);
    // right: chosen decoded/heat mode
    gl.scissor(half, 0, canvas.width - half, canvas.height);
    gl.viewport(half, 0, canvas.width - half, canvas.height);
    gl.uniform1i(loc.mode, state.viewMode === 0 ? 1 : 2);
    gl.drawElements(gl.TRIANGLES, state.vao.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame);
  }

  loadMesh(0);
  frame();
  return {
    setMesh: loadMesh,
    setMode(m) { state.mode = m; loadMesh(state.meshIndex); },
    setViewMode(v) { state.viewMode = v; },
    setHeatMetric(v) { state.heatMetric = v; },
    rotate(dy, dp) { yaw += dy; pitch = Math.max(-1.5, Math.min(1.5, pitch + dp)); },
    getState: () => state,
  };
}
