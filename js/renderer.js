import { m4 } from './math3.js';
import { computeVertexNormals } from './mesh.js';

const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  gl_Position = uViewProj * world;
}`;

const MESH_FS = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 uColor;
uniform vec3 uEye;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(vec3(0.5, 0.8, 0.6));
  float diff = max(dot(n, l), 0.0);
  vec3 v = normalize(uEye - vWorld);
  vec3 h = normalize(l + v);
  float spec = pow(max(dot(n, h), 0.0), 32.0) * 0.35;
  vec3 col = uColor * (0.25 + 0.75 * diff) + vec3(spec);
  fragColor = vec4(col, 1.0);
}`;

const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in float aDist;
uniform mat4 uViewProj;
out float vDist;
void main() {
  vDist = aDist;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const LINE_FS = `#version 300 es
precision mediump float;
in float vDist;
uniform vec4 uColor;
uniform float uDash; // 0 = solid, >0 = dash period in world units
out vec4 fragColor;
void main() {
  if (uDash > 0.0 && mod(vDist, uDash) > uDash * 0.5) discard;
  fragColor = uColor;
}`;

const POINT_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform float uSize;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  gl_PointSize = uSize;
}`;

const POINT_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  fragColor = uColor;
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function link(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('WebGL2 不可用');
    this.gl = gl;
    this.meshProg = link(gl, MESH_VS, MESH_FS);
    this.lineProg = link(gl, LINE_VS, LINE_FS);
    this.pointProg = link(gl, POINT_VS, POINT_FS);
    this.meshGpu = new Map(); // mesh.id -> { vao, count, posBuf, nrmBuf, idxBuf }
    this.lineVao = gl.createVertexArray();
    this.linePosBuf = gl.createBuffer();
    this.lineDistBuf = gl.createBuffer();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linePosBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineDistBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.pointVao = gl.createVertexArray();
    this.pointBuf = gl.createBuffer();
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  resize() {
    const c = this.gl.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(c.clientWidth * dpr);
    const h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    this.gl.viewport(0, 0, c.width, c.height);
  }

  syncMesh(mesh) {
    const gl = this.gl;
    let gpu = this.meshGpu.get(mesh.id);
    if (!gpu) {
      gpu = {
        vao: gl.createVertexArray(),
        posBuf: gl.createBuffer(),
        nrmBuf: gl.createBuffer(),
        idxBuf: gl.createBuffer(),
        count: 0,
      };
      gl.bindVertexArray(gpu.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.nrmBuf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.idxBuf);
      gl.bindVertexArray(null);
      this.meshGpu.set(mesh.id, gpu);
    }
    if (mesh.dirty) {
      const normals = computeVertexNormals(mesh.positions, mesh.indices);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.positions), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.nrmBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.indices), gl.DYNAMIC_DRAW);
      gpu.count = mesh.indices.length;
      mesh.dirty = false;
    }
    return gpu;
  }

  dropMesh(meshId) {
    const gpu = this.meshGpu.get(meshId);
    if (!gpu) return;
    const gl = this.gl;
    gl.deleteVertexArray(gpu.vao);
    gl.deleteBuffer(gpu.posBuf);
    gl.deleteBuffer(gpu.nrmBuf);
    gl.deleteBuffer(gpu.idxBuf);
    this.meshGpu.delete(meshId);
  }
}

export function normalMatrix3(model) {
  const inv = m4.invert(model);
  if (!inv) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // transpose of inverse, upper 3x3
  return [inv[0], inv[4], inv[8], inv[1], inv[5], inv[9], inv[2], inv[6], inv[10]];
}
