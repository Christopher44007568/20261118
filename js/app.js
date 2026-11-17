import { m4 } from './math3.js';
import { createSphere, createTorus, createGrid } from './primitives.js';
import { Renderer, normalMatrix3 } from './renderer.js';
import { OrbitCamera } from './camera.js';
import { pickTriangle, isOccluded } from './picking.js';
import {
  createAnchor,
  resolveAnchor,
  createMeasurement,
  straightDistance,
  surfaceDistance,
  serializeMeasurements,
  deserializeMeasurements,
} from './measure.js';

const canvas = document.getElementById('gl');
const labelLayer = document.getElementById('labels');
const renderer = new Renderer(canvas);
const camera = new OrbitCamera();

// ---- Scene -------------------------------------------------------------
const meshes = [];
const meshById = new Map();

function addMesh(mesh, translation, scale = [1, 1, 1]) {
  mesh.translation = translation;
  mesh.scale = scale;
  meshes.push(mesh);
  meshById.set(mesh.id, mesh);
  return mesh;
}

addMesh(createSphere(), [-1.6, 0, 0]);
addMesh(createTorus(), [1.6, 0, 0]);
addMesh(createGrid(), [0, -1.2, 0], [1.4, 1, 1.4]);

// ---- Measurement state ---------------------------------------------------
const measurements = [];
let measureArmed = false;
let pendingAnchor = null;   // first picked point of a pair
let rebindTarget = null;    // { measurement, end: 'a' | 'b' } awaiting re-pick
let occlusionDashed = false; // false = hide occluded labels, true = dashed
let listDirty = false;       // scene changed -> refresh distances in side list

const $ = (id) => document.getElementById(id);
const meshSelect = $('meshSelect');

function refreshMeshSelect() {
  meshSelect.innerHTML = '';
  for (const m of meshes) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.name} (${m.id}, 拓扑 v${m.topologyVersion})`;
    meshSelect.appendChild(opt);
  }
}
refreshMeshSelect();

function selectedMesh() {
  return meshById.get(meshSelect.value) ?? meshes[0];
}

function syncMeshControls() {
  const m = selectedMesh();
  $('scaleX').value = m.scale[0];
  $('scaleY').value = m.scale[1];
  $('scaleZ').value = m.scale[2];
  $('deform').value = m.deformAmount;
}
meshSelect.addEventListener('change', syncMeshControls);
syncMeshControls();

for (const [id, axis] of [['scaleX', 0], ['scaleY', 1], ['scaleZ', 2]]) {
  $(id).addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v) && Math.abs(v) > 1e-6) selectedMesh().scale[axis] = v;
    listDirty = true;
  });
}
$('deform').addEventListener('input', (e) => {
  selectedMesh().setDeform(parseFloat(e.target.value));
  listDirty = true;
});
$('btnSubdivide').addEventListener('click', () => {
  selectedMesh().subdivide();
  refreshMeshSelect();
  listDirty = true;
});
$('btnCollapse').addEventListener('click', () => {
  selectedMesh().collapseFirstTriangle();
  listDirty = true;
});

// ---- Picking -------------------------------------------------------------
canvas.addEventListener('click', (e) => {
  if (!measureArmed && !rebindTarget) return;
  const rect = canvas.getBoundingClientRect();
  const ray = camera.ray(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
  const hit = pickTriangle(meshes, ray.origin, ray.dir);
  if (!hit) return;
  const anchor = createAnchor(hit.mesh, hit.triIndex, hit.u, hit.v);

  if (rebindTarget) {
    // Rebind replaces one end of an invalid measurement with a freshly
    // picked anchor; the old (stale) anchor is discarded, never remapped.
    rebindTarget.measurement[rebindTarget.end] = anchor;
    rebindTarget = null;
    $('hint').textContent = '提示: 左键拖动旋转, 滚轮缩放, 右键平移。测量模式下点击网格表面放置锚点。';
    updateMeasureList();
    return;
  }
  if (!pendingAnchor) {
    pendingAnchor = anchor;
  } else {
    measurements.push(createMeasurement(pendingAnchor, anchor));
    pendingAnchor = null;
    measureArmed = false;
    $('btnMeasure').classList.remove('armed');
    updateMeasureList();
  }
});

$('btnMeasure').addEventListener('click', () => {
  measureArmed = !measureArmed;
  pendingAnchor = null;
  $('btnMeasure').classList.toggle('armed', measureArmed);
});
$('btnClear').addEventListener('click', () => {
  measurements.length = 0;
  pendingAnchor = null;
  updateMeasureList();
});
$('occlusionMode').addEventListener('change', (e) => {
  occlusionDashed = e.target.checked;
});

// ---- Save / load -----------------------------------------------------------
$('btnSave').addEventListener('click', () => {
  const blob = new Blob([serializeMeasurements(measurements)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'measurements.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
$('btnLoad').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const loaded = deserializeMeasurements(await file.text());
    measurements.push(...loaded);
    updateMeasureList();
  } catch (err) {
    alert(`载入失败: ${err.message}`);
  }
  e.target.value = '';
});

// ---- Measurement list UI ---------------------------------------------------
function anchorStatus(anchor) {
  return resolveAnchor(anchor, meshById.get(anchor.meshId));
}

function updateMeasureList() {
  const ul = $('measureList');
  ul.innerHTML = '';
  for (const m of measurements) {
    const li = document.createElement('li');
    const ra = anchorStatus(m.a);
    const rb = anchorStatus(m.b);
    const invalid = !ra.ok || !rb.ok;
    li.classList.toggle('invalid', invalid);

    const info = document.createElement('div');
    if (invalid) {
      const reasons = [];
      if (!ra.ok) reasons.push(`端点A: ${ra.reason}`);
      if (!rb.ok) reasons.push(`端点B: ${rb.reason}`);
      info.textContent = `#${m.id} 已失效 — ${reasons.join('; ')}`;
    } else {
      const d = straightDistance(m, meshById);
      const g = surfaceDistance(m, meshById);
      info.innerHTML =
        `#${m.id} <span class="dist">直线 ${d.toFixed(4)}</span>` +
        (g != null ? ` · <span class="geo">沿表面≈${g.toFixed(4)}</span>` : ' · 跨网格, 无沿表面距离');
    }
    li.appendChild(info);

    const row = document.createElement('div');
    row.className = 'row';
    if (invalid) {
      for (const end of ['a', 'b']) {
        const r = end === 'a' ? ra : rb;
        if (r.ok) continue;
        const btn = document.createElement('button');
        btn.textContent = `重新绑定端点${end.toUpperCase()}`;
        btn.addEventListener('click', () => {
          rebindTarget = { measurement: m, end };
          measureArmed = false;
          $('btnMeasure').classList.remove('armed');
          $('hint').textContent = '重新绑定: 点击网格表面放置新锚点。';
        });
        row.appendChild(btn);
      }
    }
    const del = document.createElement('button');
    del.textContent = '删除';
    del.addEventListener('click', () => {
      measurements.splice(measurements.indexOf(m), 1);
      updateMeasureList();
    });
    row.appendChild(del);
    li.appendChild(row);
    ul.appendChild(li);
  }
}

// ---- Rendering -------------------------------------------------------------
const MESH_COLORS = [[0.55, 0.7, 0.9], [0.85, 0.65, 0.5], [0.55, 0.8, 0.6]];

function drawScene() {
  renderer.resize();
  const gl = renderer.gl;
  const aspect = canvas.width / canvas.height;
  const viewProj = camera.viewProj(aspect);
  const eye = camera.eye();

  gl.clearColor(0.1, 0.11, 0.13, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);

  // Meshes
  gl.useProgram(renderer.meshProg);
  gl.uniformMatrix4fv(gl.getUniformLocation(renderer.meshProg, 'uViewProj'), false, viewProj);
  gl.uniform3fv(gl.getUniformLocation(renderer.meshProg, 'uEye'), eye);
  meshes.forEach((mesh, i) => {
    const gpu = renderer.syncMesh(mesh);
    const model = mesh.modelMatrix();
    gl.uniformMatrix4fv(gl.getUniformLocation(renderer.meshProg, 'uModel'), false, model);
    gl.uniformMatrix3fv(gl.getUniformLocation(renderer.meshProg, 'uNormalMat'), false, normalMatrix3(model));
    gl.uniform3fv(gl.getUniformLocation(renderer.meshProg, 'uColor'), MESH_COLORS[i % MESH_COLORS.length]);
    gl.bindVertexArray(gpu.vao);
    gl.drawElements(gl.TRIANGLES, gpu.count, gl.UNSIGNED_INT, 0);
  });
  gl.bindVertexArray(null);

  // Resolve anchors once per frame.
  const resolved = measurements.map((m) => ({
    m,
    ra: anchorStatus(m.a),
    rb: anchorStatus(m.b),
  }));

  // Measurement lines: two depth passes. Visible part = solid (LEQUAL),
  // occluded part = dashed (GREATER) when enabled, hidden otherwise.
  const linePos = [];
  const lineDist = [];
  const occludedPos = [];
  const occludedDist = [];
  for (const { ra, rb } of resolved) {
    if (!ra.ok || !rb.ok) continue;
    const len = Math.hypot(
      ra.position[0] - rb.position[0],
      ra.position[1] - rb.position[1],
      ra.position[2] - rb.position[2]
    );
    linePos.push(...ra.position, ...rb.position);
    lineDist.push(0, len);
    if (occlusionDashed) {
      occludedPos.push(...ra.position, ...rb.position);
      occludedDist.push(0, len);
    }
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(renderer.lineProg);
  gl.uniformMatrix4fv(gl.getUniformLocation(renderer.lineProg, 'uViewProj'), false, viewProj);
  gl.bindVertexArray(renderer.lineVao);

  const drawLines = (pos, dist, color, dash, depthFunc) => {
    if (!pos.length) return;
    gl.depthFunc(depthFunc);
    gl.uniform4fv(gl.getUniformLocation(renderer.lineProg, 'uColor'), color);
    gl.uniform1f(gl.getUniformLocation(renderer.lineProg, 'uDash'), dash);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.linePosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.lineDistBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dist), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, pos.length / 3);
  };
  drawLines(linePos, lineDist, [0.4, 0.9, 1.0, 1.0], 0, gl.LEQUAL);
  drawLines(occludedPos, occludedDist, [0.4, 0.9, 1.0, 0.55], 0.08, gl.GREATER);
  gl.depthFunc(gl.LEQUAL);

  // Anchor points
  const pts = [];
  for (const { ra, rb } of resolved) {
    if (ra.ok) pts.push(...ra.position);
    if (rb.ok) pts.push(...rb.position);
  }
  if (pendingAnchor) {
    const r = anchorStatus(pendingAnchor);
    if (r.ok) pts.push(...r.position);
  }
  if (pts.length) {
    gl.useProgram(renderer.pointProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(renderer.pointProg, 'uViewProj'), false, viewProj);
    gl.uniform1f(gl.getUniformLocation(renderer.pointProg, 'uSize'), 10.0);
    gl.uniform4fv(gl.getUniformLocation(renderer.pointProg, 'uColor'), [1.0, 0.55, 0.2, 1.0]);
    gl.bindVertexArray(renderer.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.POINTS, 0, pts.length / 3);
    gl.bindVertexArray(null);
  }
  gl.disable(gl.BLEND);

  updateLabels(resolved, viewProj, eye);
}

// ---- HTML labels -----------------------------------------------------------
function updateLabels(resolved, viewProj, eye) {
  labelLayer.innerHTML = '';
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (const { m, ra, rb } of resolved) {
    if (!ra.ok || !rb.ok) continue;
    const mid = [
      (ra.position[0] + rb.position[0]) / 2,
      (ra.position[1] + rb.position[1]) / 2,
      (ra.position[2] + rb.position[2]) / 2,
    ];
    const ndc = m4.project(viewProj, mid);
    if (ndc[2] < -1 || ndc[2] > 1) continue;
    const x = (ndc[0] * 0.5 + 0.5) * w;
    const y = (1 - (ndc[1] * 0.5 + 0.5)) * h;

    const occluded = isOccluded(meshes, eye, mid);
    if (occluded && !occlusionDashed) continue; // hide mode

    const d = straightDistance(m, meshById);
    const g = surfaceDistance(m, meshById);
    const div = document.createElement('div');
    div.className = 'mlabel' + (occluded ? ' occluded' : '');
    div.style.left = `${x}px`;
    div.style.top = `${y}px`;
    div.textContent =
      `直线 ${d.toFixed(3)}` + (g != null ? ` | 沿表面≈${g.toFixed(3)}` : '');
    labelLayer.appendChild(div);
  }
}

// ---- Main loop ---------------------------------------------------------------
function frame() {
  drawScene();
  // Refresh distances in the side list only after scene edits, so the DOM
  // isn't churned every frame.
  if (listDirty && measurements.length) {
    listDirty = false;
    updateMeasureList();
  }
  requestAnimationFrame(frame);
}
camera.attach(canvas, () => {});
frame();
