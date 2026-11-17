// WebGL2 GPU skinning demo: bone matrix palette uploaded as uniforms,
// crossfaded run/wave clips, bind-pose toggle, per-bone influence highlight.
import { Mat4 } from './math.js';
import {
  BONES, BONE_COUNT, computeWorldMatrices, computeBoneMatrices, flattenMatrices,
} from './rig.js';
import { buildMesh, skinCPU, computeAABB } from './mesh.js';
import { Crossfader, CLIPS } from './anim.js';

const canvas = document.getElementById('view');
const gl = canvas.getContext('webgl2');
if (!gl) {
  document.body.innerHTML = '<p style="color:#fff">需要 WebGL2 支持</p>';
  throw new Error('WebGL2 unavailable');
}

const SKIN_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aJoints;
layout(location=3) in vec4 aWeights;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uBones[${BONE_COUNT}];
uniform bool uSkinning;
uniform int uHighlight;
out vec3 vNormal;
out float vHl;
void main() {
  ivec4 j = ivec4(aJoints);
  mat4 skin = mat4(1.0);
  if (uSkinning) {
    skin = uBones[j.x] * aWeights.x + uBones[j.y] * aWeights.y
         + uBones[j.z] * aWeights.z + uBones[j.w] * aWeights.w;
  }
  vec4 wp = skin * vec4(aPos, 1.0);
  vNormal = mat3(skin) * aNormal;
  vHl = 0.0;
  if (uHighlight >= 0) {
    for (int k = 0; k < 4; k++) {
      if (j[k] == uHighlight) vHl += aWeights[k];
    }
  }
  gl_Position = uProj * uView * wp;
}`;

const SKIN_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vHl;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(vec3(0.5, 0.8, 0.6))), 0.0);
  vec3 base = vec3(0.72, 0.62, 0.55);
  vec3 col = base * (0.25 + 0.75 * diff);
  col = mix(col, vec3(1.0, 0.15, 0.1), clamp(vHl, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}`;

const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uProj;
uniform mat4 uView;
void main() { gl_Position = uProj * uView * vec4(aPos, 1.0); }`;

const LINE_FS = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor, 1.0); }`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s));
  }
  return s;
}

function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p));
  }
  return p;
}

const skinProg = program(SKIN_VS, SKIN_FS);
const lineProg = program(LINE_VS, LINE_FS);
const U = (p, n) => gl.getUniformLocation(p, n);
const skinU = {
  proj: U(skinProg, 'uProj'), view: U(skinProg, 'uView'),
  bones: U(skinProg, 'uBones[0]'), skinning: U(skinProg, 'uSkinning'),
  highlight: U(skinProg, 'uHighlight'),
};
const lineU = {
  proj: U(lineProg, 'uProj'), view: U(lineProg, 'uView'), color: U(lineProg, 'uColor'),
};

// --- Mesh VAO ---
const mesh = buildMesh();
const meshVAO = gl.createVertexArray();
gl.bindVertexArray(meshVAO);
function attrib(loc, data, size, type) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, type, false, 0, 0);
}
attrib(0, mesh.positions, 3, gl.FLOAT);
attrib(1, mesh.normals, 3, gl.FLOAT);
attrib(2, new Float32Array(mesh.joints), 4, gl.FLOAT);
attrib(3, mesh.weights, 4, gl.FLOAT);
const ibo = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

// --- Ground grid VAO ---
const gridPts = [];
for (let i = -5; i <= 5; i++) {
  gridPts.push(i * 0.4, 0, -2, i * 0.4, 0, 2, -2, 0, i * 0.4, 2, 0, i * 0.4);
}
const gridVAO = gl.createVertexArray();
gl.bindVertexArray(gridVAO);
attrib(0, new Float32Array(gridPts), 3, gl.FLOAT);
const gridCount = gridPts.length / 3;

// --- Skeleton lines VAO (dynamic, one segment per bone) ---
const skelVAO = gl.createVertexArray();
gl.bindVertexArray(skelVAO);
const skelBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, skelBuf);
gl.bufferData(gl.ARRAY_BUFFER, BONE_COUNT * 6 * 4, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

function updateSkeletonLines(world) {
  const pts = new Float32Array(BONE_COUNT * 6);
  for (let i = 0; i < BONE_COUNT; i++) {
    const c = Mat4.translation(world[i]);
    const p = BONES[i].parent < 0 ? c : Mat4.translation(world[BONES[i].parent]);
    pts.set([...p, ...c], i * 6);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, skelBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, pts);
}

// --- Orbit camera ---
let camYaw = 0.5, camPitch = 0.25, camDist = 3.4;
canvas.addEventListener('pointerdown', (e) => {
  const sx = e.clientX, sy = e.clientY, y0 = camYaw, p0 = camPitch;
  const move = (ev) => {
    camYaw = y0 + (ev.clientX - sx) * 0.01;
    camPitch = Math.min(1.4, Math.max(-0.2, p0 + (ev.clientY - sy) * 0.01));
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});
canvas.addEventListener('wheel', (e) => {
  camDist = Math.min(8, Math.max(1.5, camDist + e.deltaY * 0.003));
});

// --- UI ---
const fader = new Crossfader(0.4);
const $ = (id) => document.getElementById(id);
$('btnRun').onclick = () => fader.play('run');
$('btnWave').onclick = () => fader.play('wave');
const selBone = $('selBone');
BONES.forEach((b, i) => {
  const o = document.createElement('option');
  o.value = i;
  o.textContent = b.name;
  selBone.appendChild(o);
});

$('btnExport').onclick = () => {
  const sim = new Crossfader(0.4);
  const frames = [];
  const DT = 1 / 60;
  const run = (n) => {
    for (let i = 0; i < n; i++) {
      const pose = sim.update(DT);
      const world = computeWorldMatrices(pose);
      const boneMats = computeBoneMatrices(world);
      frames.push({
        clip: sim.target,
        blending: sim.blending,
        boneMatrices: Array.from(flattenMatrices(boneMats)),
        aabb: computeAABB(skinCPU(mesh, boneMats)),
      });
    }
  };
  run(60); sim.play('wave'); run(96); sim.play('run'); run(60);
  const blob = new Blob([JSON.stringify({
    boneNames: BONES.map((b) => b.name), frames,
  })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'frames.json';
  a.click();
  URL.revokeObjectURL(a.href);
};

// --- Render loop ---
gl.enable(gl.DEPTH_TEST);
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const pose = fader.update(dt);
  const world = computeWorldMatrices(pose);
  const boneMats = computeBoneMatrices(world);
  const palette = flattenMatrices(boneMats);

  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.clearColor(0.1, 0.11, 0.14, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const proj = Mat4.perspective(0.8, w / h, 0.1, 50);
  const eye = [
    camDist * Math.cos(camPitch) * Math.sin(camYaw),
    1.0 + camDist * Math.sin(camPitch),
    camDist * Math.cos(camPitch) * Math.cos(camYaw),
  ];
  const view = Mat4.lookAt(eye, [0, 1, 0], [0, 1, 0]);

  gl.useProgram(lineProg);
  gl.uniformMatrix4fv(lineU.proj, false, proj);
  gl.uniformMatrix4fv(lineU.view, false, view);
  gl.uniform3f(lineU.color, 0.3, 0.32, 0.36);
  gl.bindVertexArray(gridVAO);
  gl.drawArrays(gl.LINES, 0, gridCount);
  if ($('chkSkeleton').checked) {
    updateSkeletonLines(world);
    gl.uniform3f(lineU.color, 0.2, 0.9, 1.0);
    gl.bindVertexArray(skelVAO);
    gl.drawArrays(gl.LINES, 0, BONE_COUNT * 2);
  }

  gl.useProgram(skinProg);
  gl.uniformMatrix4fv(skinU.proj, false, proj);
  gl.uniformMatrix4fv(skinU.view, false, view);
  gl.uniformMatrix4fv(skinU.bones, false, palette);
  gl.uniform1i(skinU.skinning, $('chkSkin').checked ? 1 : 0);
  gl.uniform1i(skinU.highlight, parseInt(selBone.value, 10));
  gl.bindVertexArray(meshVAO);
  gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);

  const aabb = computeAABB(skinCPU(mesh, boneMats));
  $('stats').textContent =
    `动画: ${fader.target}${fader.blending ? ' (交叉淡化中)' : ''}\n` +
    `AABB min: ${aabb.min.map((x) => x.toFixed(2)).join(', ')}\n` +
    `AABB max: ${aabb.max.map((x) => x.toFixed(2)).join(', ')}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
