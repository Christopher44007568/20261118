// WebGL2 renderer: shared-geometry VAOs, one 256-byte UBO slot per node
// (re-uploaded only when that node's world matrix version changes),
// line overlay for selection AABB / axes / ground grid.

import { perspective, lookAt, multiply, invert, transformPoint } from './mat4.js';

const MESH_VS = `#version 300 es
layout(std140) uniform NodeData {
  mat4 uWorld;
  vec4 uColor;
};
uniform mat4 uViewProj;
in vec3 aPos;
in vec3 aNormal;
out vec3 vNormal;
out vec4 vColor;
void main() {
  vNormal = mat3(uWorld) * aNormal;
  vColor = uColor;
  gl_Position = uViewProj * uWorld * vec4(aPos, 1.0);
}`;

const MESH_FS = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec4 vColor;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.5, 0.9, 0.4));
  float diff = max(dot(n, lightDir), 0.0);
  vec3 ambient = vec3(0.25);
  outColor = vec4(vColor.rgb * (ambient + diff * 0.85), vColor.a);
}`;

const LINE_VS = `#version 300 es
uniform mat4 uViewProj;
in vec3 aPos;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }`;

const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

const UBO_SLOT_SIZE = 256; // std140 alignment-safe stride per node

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh));
  }
  return sh;
}

function link(gl, vsSrc, fsSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog));
  }
  return prog;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;

    this.meshProg = link(gl, MESH_VS, MESH_FS);
    this.meshViewProjLoc = gl.getUniformLocation(this.meshProg, 'uViewProj');
    this.lineProg = link(gl, LINE_VS, LINE_FS);
    this.lineViewProjLoc = gl.getUniformLocation(this.lineProg, 'uViewProj');
    this.lineColorLoc = gl.getUniformLocation(this.lineProg, 'uColor');

    this.meshVAOs = new Map();   // MeshAsset -> vao record (uploaded once)
    this.nodeSlots = new Map();  // node.id -> { offset, uploadedVersion }
    this.nodeUBO = gl.createBuffer();
    this.lineVBO = gl.createBuffer();
    this.lineVAO = gl.createVertexArray();
    gl.bindVertexArray(this.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.camera = { yaw: 0.8, pitch: 0.5, dist: 14, target: [0, 1, 0] };
    this.lastStats = { drawn: 0, culled: 0, uploaded: 0, updated: 0 };

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  // Upload each shared mesh asset exactly once; nodes reference the same VAO.
  syncMeshes(meshAssets) {
    const gl = this.gl;
    for (const mesh of Object.values(meshAssets)) {
      if (this.meshVAOs.has(mesh)) continue;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const nrmBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      const idxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.meshVAOs.set(mesh, { vao, count: mesh.indices.length });
    }
  }

  // Allocate one UBO slot per node; slots persist across frames.
  syncNodeSlots(graph) {
    const gl = this.gl;
    let maxSlot = -1;
    for (const node of graph.walk()) {
      if (!this.nodeSlots.has(node.id)) {
        this.nodeSlots.set(node.id, {
          offset: (node.id - 1) * UBO_SLOT_SIZE,
          uploadedVersion: -1,
        });
      }
      maxSlot = Math.max(maxSlot, this.nodeSlots.get(node.id).offset);
    }
    const required = maxSlot + UBO_SLOT_SIZE;
    if (this.uboSize !== required) {
      this.uboSize = required;
      gl.bindBuffer(gl.UNIFORM_BUFFER, this.nodeUBO);
      gl.bufferData(gl.UNIFORM_BUFFER, required, gl.DYNAMIC_DRAW);
    }
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  viewProj() {
    const { yaw, pitch, dist, target } = this.camera;
    const eye = [
      target[0] + dist * Math.cos(pitch) * Math.sin(yaw),
      target[1] + dist * Math.sin(pitch),
      target[2] + dist * Math.cos(pitch) * Math.cos(yaw),
    ];
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = perspective(Math.PI / 4, aspect, 0.1, 200);
    const view = lookAt(eye, target, [0, 1, 0]);
    return { vp: multiply(proj, view), eye };
  }

  // Convert a canvas client position to a world-space ray (for dragging).
  screenRay(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const { vp, eye } = this.viewProj();
    const inv = invert(vp);
    const near = transformPoint(inv, [nx, ny, -1]);
    const far = transformPoint(inv, [nx, ny, 1]);
    const dir = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    return { origin: eye, dir: [dir[0] / len, dir[1] / len, dir[2] / len] };
  }

  // Render one frame. Only nodes whose world matrix version changed AND
  // that survive culling get their UBO slot re-uploaded.
  render(graph, selectedNode) {
    const gl = this.gl;
    this.resize();

    const updated = graph.updateWorldMatrices();
    const { drawList, culled } = graph.collectRenderList();
    const drawSet = new Set(drawList);

    // Incremental UBO uploads for dirty, visible, drawable nodes only.
    let uploaded = 0;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.nodeUBO);
    const stage = new Float32Array(20); // mat4 + vec4
    for (const node of drawList) {
      const slot = this.nodeSlots.get(node.id);
      if (slot.uploadedVersion === node.matrixVersion) continue;
      stage.set(node.worldMatrix, 0);
      stage.set(node.color, 16);
      gl.bufferSubData(gl.UNIFORM_BUFFER, slot.offset, stage);
      slot.uploadedVersion = node.matrixVersion;
      uploaded++;
    }

    const { vp } = this.viewProj();
    gl.clearColor(0.09, 0.1, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Opaque meshes.
    gl.useProgram(this.meshProg);
    gl.uniformMatrix4fv(this.meshViewProjLoc, false, vp);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.nodeUBO);
    for (const node of drawList) {
      const slot = this.nodeSlots.get(node.id);
      gl.bindBufferRange(gl.UNIFORM_BUFFER, 0, this.nodeUBO, slot.offset, UBO_SLOT_SIZE);
      const rec = this.meshVAOs.get(node.mesh);
      gl.bindVertexArray(rec.vao);
      gl.drawElements(gl.TRIANGLES, rec.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);

    // Line overlay: ground grid, selection AABB, local axes.
    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(this.lineViewProjLoc, false, vp);
    gl.bindVertexArray(this.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVBO);
    this.drawLines(gridPositions(10, 1), [0.3, 0.32, 0.35, 1]);
    if (selectedNode && drawSetOrAncestorVisible(selectedNode, drawSet, culled)) {
      if (selectedNode.displayAABB) {
        this.drawLines(aabbEdgePositions(selectedNode.displayAABB), [1, 0.85, 0.2, 1]);
      }
      this.drawLines(axisPositions(selectedNode), null); // per-axis colors
    }
    gl.bindVertexArray(null);

    this.lastStats = { drawn: drawList.length, culled: culled.length, uploaded, updated: updated.length };
    return this.lastStats;
  }

  drawLines(positions, color) {
    const gl = this.gl;
    if (positions.length === 0) return;
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    if (color) {
      gl.uniform4fv(this.lineColorLoc, color);
      gl.drawArrays(gl.LINES, 0, positions.length / 3);
    } else {
      // Axes: 3 segments, X=red, Y=green, Z=blue.
      const colors = [[0.95, 0.25, 0.25, 1], [0.3, 0.9, 0.3, 1], [0.3, 0.5, 0.95, 1]];
      for (let i = 0; i < 3; i++) {
        gl.uniform4fv(this.lineColorLoc, colors[i]);
        gl.drawArrays(gl.LINES, i * 2, 2);
      }
    }
  }
}

function drawSetOrAncestorVisible(node, drawSet, culled) {
  return !culled.includes(node);
}

function gridPositions(half, step) {
  const pts = [];
  for (let i = -half; i <= half; i += step) {
    pts.push(i, 0, -half, i, 0, half);
    pts.push(-half, 0, i, half, 0, i);
  }
  return new Float32Array(pts);
}

function aabbEdgePositions(aabb) {
  const [x0, y0, z0] = aabb.min;
  const [x1, y1, z1] = aabb.max;
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const pts = [];
  for (const [a, b] of edges) pts.push(...c[a], ...c[b]);
  return new Float32Array(pts);
}

function axisPositions(node) {
  const m = node.worldMatrix;
  const origin = [m[12], m[13], m[14]];
  let len = 1;
  if (node.displayAABB) {
    const sx = node.displayAABB.max[0] - node.displayAABB.min[0];
    const sy = node.displayAABB.max[1] - node.displayAABB.min[1];
    const sz = node.displayAABB.max[2] - node.displayAABB.min[2];
    len = Math.max(sx, sy, sz) * 0.75 || 1;
  }
  const pts = [];
  for (let axis = 0; axis < 3; axis++) {
    const dir = [m[axis * 4], m[axis * 4 + 1], m[axis * 4 + 2]];
    const d = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    pts.push(
      ...origin,
      origin[0] + (dir[0] / d) * len,
      origin[1] + (dir[1] / d) * len,
      origin[2] + (dir[2] / d) * len,
    );
  }
  return new Float32Array(pts);
}
