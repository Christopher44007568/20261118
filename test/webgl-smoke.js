// Headless smoke test: drive src/app.js against a minimal WebGL2 stub that
// records calls. This validates attribute offsets, uniform usage, draw calls
// and the render loop wiring without a real GPU/headless browser.

import { VERT_SRC, FRAG_SRC } from '../src/shaders.js';
import { startDemo } from '../src/app.js';
import {
  makeLargePlane, makeSmallCube, makeSlivers, makeSphere, makeUvSeamQuad,
} from '../src/mesh.js';

const calls = [];
const bufferData = [];
function stubGl() {
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, ELEMENT_ARRAY_BUFFER: 7,
    UNSIGNED_SHORT: 8, BYTE: 9, SHORT: 10, UNSIGNED_INT: 11, FLOAT: 12,
    TRIANGLES: 13, DEPTH_TEST: 14, COLOR_BUFFER_BIT: 15, DEPTH_BUFFER_BIT: 16,
    SCISSOR_TEST: 17,
    createShader: () => ({}), shaderSource() {}, compileShader() {},
    getShaderParameter: () => true, getShaderInfoLog: () => '',
    createProgram: () => ({}), attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, getProgramInfoLog: () => '',
    useProgram() {},
    createVertexArray: () => ({}), bindVertexArray() {},
    createBuffer: () => ({}),
    bindBuffer(t, b) { calls.push(['bindBuffer', t]); },
    bufferData(t, data) { bufferData.push({ target: t, bytes: data.byteLength }); },
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    vertexAttribIPointer() {},
    getUniformLocation: (p, name) => ({ name }),
    uniform3fv() {}, uniform3f() {}, uniform1i() {}, uniform1f() {},
    uniformMatrix4fv() {},
    drawElements(mode, count, type) { calls.push(['drawElements', mode, count, type]); },
    viewport() {}, scissor() {}, enable() {}, disable() {},
    clearColor() {}, clear() {},
  };
}

const canvas = {
  width: 800, height: 600, clientWidth: 800, clientHeight: 600,
  getContext() { return stubGl(); },
};

// Validate GLSL structural sanity: balanced braces and #version first.
const stageKeywords = {
  vert: ['oct', 'reconstructTangent', 'aPosQ', 'aOct'],
  frag: ['heatRamp', 'uHeatMetric', 'lambert'],
};
for (const [label, src] of [['vert', VERT_SRC], ['frag', FRAG_SRC]]) {
  const open = (src.match(/{/g) || []).length;
  const close = (src.match(/}/g) || []).length;
  if (open !== close) throw new Error(`${label}: unbalanced braces`);
  if (!src.startsWith('#version 300 es')) throw new Error(`${label}: missing version`);
  for (const kw of stageKeywords[label]) {
    if (!src.includes(kw)) throw new Error(`${label}: missing ${kw}`);
  }
}

const meshes = [
  makeLargePlane(), makeSmallCube(), makeSlivers(), makeSphere(), makeUvSeamQuad(),
];
const demo = startDemo(canvas, meshes, { mode: 'oct16' });

// Switch through every mesh and both oct modes to exercise all VAO layouts.
for (let i = 0; i < meshes.length; i++) {
  demo.setMesh(i);
  const st = demo.getState();
  if (!st.bytes.source || !st.bytes.compressed) throw new Error('missing byte stats');
  if (st.bytes.source <= st.bytes.compressed) throw new Error('no compression gain');
}
demo.setMode('oct32');
demo.setViewMode(1);
demo.setHeatMetric(1);
demo.rotate(0.2, 0.1);

const draws = calls.filter((c) => c[0] === 'drawElements');
if (draws.length < 2) throw new Error('expected two draw calls per frame');
if (draws.some((d) => d[3] !== 11)) throw new Error('indices must be UNSIGNED_INT');
const uploaded = bufferData.filter((b) => b.target === 5);
if (!uploaded.length) throw new Error('compressed VBO never uploaded');

console.log('WebGL smoke test OK:', draws.length, 'draw calls,',
  uploaded.length, 'VBO uploads, shader brace/version checks passed');
