import { createProgram } from './glutil.js';

const GEOM_VS = `#version 300 es
in vec2 aPos;
in float aDepth;
in vec3 aColor;
uniform mat3 uModel;
out vec3 vColor;
void main() {
  vec3 p = uModel * vec3(aPos, 1.0);
  gl_Position = vec4(p.xy, aDepth, 1.0);
  vColor = aColor;
}`;

const GEOM_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 frag;
void main() { frag = vec4(vColor, 1.0); }`;

const PRESENT_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const PRESENT_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 frag;
void main() { frag = texture(uTex, vUv); }`;

export const BACKGROUND = [10 / 255, 14 / 255, 24 / 255];

function mat3Identity() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}
function mat3Translate(m, tx, ty) {
  const r = m.slice();
  r[6] += m[0] * tx + m[3] * ty;
  r[7] += m[1] * tx + m[4] * ty;
  return r;
}
function mat3Rotate(m, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const rot = [c, -s, 0, s, c, 0, 0, 0, 1];
  const out = new Array(9).fill(0);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 3; k++) {
        out[col * 3 + row] += rot[k * 3 + row] * m[col * 3 + k];
      }
    }
  }
  return out;
}

function polygonVertices(sides, radius, depth, color) {
  const data = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    data.push(0, 0, depth, ...color);
    data.push(Math.cos(a0) * radius, Math.sin(a0) * radius, depth, ...color);
    data.push(Math.cos(a1) * radius, Math.sin(a1) * radius, depth, ...color);
  }
  return new Float32Array(data);
}

// 细长四边形（三角带形式的两个三角形），斜放时最容易暴露锯齿。
function thinStrip(length, width, depth, color, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const local = [
    [-length / 2, -width / 2], [length / 2, -width / 2],
    [-length / 2, width / 2], [length / 2, width / 2],
  ];
  const pts = local.map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const data = [];
  const tri = [0, 1, 2, 2, 1, 3];
  for (const idx of tri) {
    data.push(pts[idx][0], pts[idx][1], depth, ...color);
  }
  return new Float32Array(data);
}

export class Scene {
  constructor(gl) {
    this.gl = gl;
    this.geomProgram = createProgram(gl, GEOM_VS, GEOM_FS);
    this.presentProgram = createProgram(gl, PRESENT_VS, PRESENT_FS);
    this.loc = {
      aPos: gl.getAttribLocation(this.geomProgram, 'aPos'),
      aDepth: gl.getAttribLocation(this.geomProgram, 'aDepth'),
      aColor: gl.getAttribLocation(this.geomProgram, 'aColor'),
      uModel: gl.getUniformLocation(this.geomProgram, 'uModel'),
    };
    this.pLoc = {
      aPos: gl.getAttribLocation(this.presentProgram, 'aPos'),
      uTex: gl.getUniformLocation(this.presentProgram, 'uTex'),
    };
    this.meshes = this._buildMeshes(gl);
    this._buildQuad(gl);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  _buildMeshes(gl) {
    const red = [0.98, 0.30, 0.30];
    const yellow = [0.95, 0.80, 0.25];
    const cyan = [0.25, 0.85, 0.90];
    const violet = [0.65, 0.45, 0.95];
    const defs = [
      { verts: polygonVertices(3, 0.42, 0.6, red), tx: -0.32, ty: 0.12, spin: 0.7 },
      { verts: polygonVertices(5, 0.34, 0.4, yellow), tx: 0.30, ty: -0.10, spin: -0.9 },
      { verts: polygonVertices(4, 0.16, 0.25, violet), tx: 0.05, ty: 0.05, spin: 1.6, orbit: true },
      { verts: thinStrip(1.6, 0.014, 0.5, cyan, 0.18), tx: 0, ty: 0.28, spin: 0.25 },
      { verts: thinStrip(1.4, 0.010, 0.55, cyan, -0.32), tx: 0.1, ty: -0.3, spin: -0.2 },
      { verts: thinStrip(1.2, 0.008, 0.52, cyan, 0.07), tx: -0.25, ty: -0.05, spin: 0.35 },
    ];
    return defs.map((def) => {
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, def.verts, gl.STATIC_DRAW);
      return { ...def, vbo, count: def.verts.length / 6 };
    });
  }

  _buildQuad(gl) {
    this.quadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
  }

  drawGeometry(target, time, { clearDepth = true } = {}) {
    const gl = this.gl;
    target.bindForGeometry(gl);
    gl.clearColor(...BACKGROUND, 1);
    const mask = clearDepth
      ? gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT
      : gl.COLOR_BUFFER_BIT;
    gl.clear(mask);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.geomProgram);
    for (const mesh of this.meshes) {
      let model = mat3Identity();
      let tx = mesh.tx, ty = mesh.ty;
      if (mesh.orbit) {
        tx += Math.cos(time * 0.8) * 0.28;
        ty += Math.sin(time * 0.8) * 0.28;
      }
      model = mat3Translate(model, tx, ty);
      model = mat3Rotate(model, time * mesh.spin);
      gl.uniformMatrix3fv(this.loc.uModel, false, model);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
      const stride = 6 * 4;
      gl.enableVertexAttribArray(this.loc.aPos);
      gl.vertexAttribPointer(this.loc.aPos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(this.loc.aDepth);
      gl.vertexAttribPointer(this.loc.aDepth, 1, gl.FLOAT, false, stride, 2 * 4);
      gl.enableVertexAttribArray(this.loc.aColor);
      gl.vertexAttribPointer(this.loc.aColor, 3, gl.FLOAT, false, stride, 3 * 4);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
  }

  // 以固定时间渲染一帧（不推进动画），用于跨采样模式的形状一致性对比。
  renderStaticFrame(target, fixedTime) {
    this.drawGeometry(target, fixedTime, { clearDepth: true });
    target.resolve(this.gl);
  }

  drawPresent(target, canvasWidth, canvasHeight) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.presentProgram);
    target.bindColorTexture(gl);
    gl.uniform1i(this.pLoc.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(this.pLoc.aPos);
    gl.vertexAttribPointer(this.pLoc.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.DEPTH_TEST);
  }
}
