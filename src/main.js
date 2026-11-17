import * as THREE from 'three';
import { buildRoom, buildProbes } from './scene.js';
import {
  sampleTet,
  nearestProbe,
  cellProbe,
  applyOcclusion,
} from './probes.js';
import {
  createProbeSphereMaterial,
  setMaterialProbes,
} from './sphereMaterial.js';

const MODES = {
  cell: '逐探针',
  nearest: '最近单探针',
  tet: '四点插值',
};

// ---------- 渲染器 / 相机 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NoToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101114);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
const camTarget = new THREE.Vector3(3.2, 1.2, 3.2);
let camAzim = Math.PI / 4;
let camElev = 0.62;
let camDist = 13;
function updateCamera() {
  camera.position.set(
    camTarget.x + camDist * Math.cos(camElev) * Math.cos(camAzim),
    camTarget.y + camDist * Math.sin(camElev),
    camTarget.z + camDist * Math.cos(camElev) * Math.sin(camAzim)
  );
  camera.lookAt(camTarget);
}
updateCamera();

let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  camAzim -= (e.clientX - drag.x) * 0.005;
  camElev = Math.min(
    1.4,
    Math.max(0.1, camElev + (e.clientY - drag.y) * 0.005)
  );
  drag = { x: e.clientX, y: e.clientY };
  updateCamera();
});
window.addEventListener('pointerup', () => (drag = null));
renderer.domElement.addEventListener('wheel', (e) => {
  camDist = Math.min(30, Math.max(5, camDist + e.deltaY * 0.01));
  updateCamera();
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 场景 ----------
const dynamicGroup = new THREE.Group();
scene.add(dynamicGroup);
const { occluders } = buildRoom(scene);

// ---------- 反光球（三种模式） ----------
const sphereGeo = new THREE.SphereGeometry(0.55, 48, 32);
function makeTextSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#fff';
  g.font = '30px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      depthTest: false,
    })
  );
  sp.scale.set(1.8, 0.45, 1);
  return sp;
}

const spheres = ['cell', 'nearest', 'tet'].map((mode) => {
  const material = createProbeSphereMaterial(0xffffff);
  const mesh = new THREE.Mesh(sphereGeo, material);
  const label = makeTextSprite(MODES[mode]);
  label.position.y = 1.0;
  mesh.add(label);
  dynamicGroup.add(mesh);
  return { mode, mesh, material, visMap: new Map(), active: null };
});

// ---------- 探针烘焙 ----------
const { grid, probes } = buildProbes(scene, renderer, [dynamicGroup]);

// ---------- 探针可视化 ----------
const probeViz = probes.map((probe) => {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x555a60 })
  );
  m.position.set(...probe.position);
  scene.add(m);
  return m;
});

const linkGeo = new THREE.BufferGeometry();
linkGeo.setAttribute(
  'position',
  new THREE.BufferAttribute(new Float32Array(8 * 3), 3)
);
linkGeo.setAttribute(
  'color',
  new THREE.BufferAttribute(new Float32Array(8 * 3), 3)
);
const linkLines = new THREE.LineSegments(
  linkGeo,
  new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
);
linkLines.frustumCulled = false;
scene.add(linkLines);

// ---------- 采样与遮挡 ----------
const raycaster = new THREE.Raycaster();
const tmpDir = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();

function probeVisibility(from, probeIdx) {
  const p = probes[probeIdx].position;
  tmpDir.set(p[0] - from.x, p[1] - from.y, p[2] - from.z);
  const dist = tmpDir.length();
  tmpDir.normalize();
  tmpFrom.copy(from).addScaledVector(tmpDir, 0.6); // 跳过球体自身
  raycaster.set(tmpFrom, tmpDir);
  raycaster.far = dist - 0.65;
  return raycaster.intersectObjects(occluders, false).length === 0 ? 1 : 0;
}

// 计算一个球体的探针分配，返回 { indices, weights, occluded }
function assignProbes(sphere, dt) {
  const pos = sphere.mesh.position;
  const p = [pos.x, pos.y, pos.z];
  if (sphere.mode === 'cell') {
    return { indices: [cellProbe(grid, p)], weights: [1], occluded: [false] };
  }
  if (sphere.mode === 'nearest') {
    return { indices: [nearestProbe(grid, p)], weights: [1], occluded: [false] };
  }
  const { indices, weights } = sampleTet(grid, p);
  const vis = indices.map((idx) => {
    const target = probeVisibility(pos, idx);
    const cur = sphere.visMap.has(idx) ? sphere.visMap.get(idx) : target;
    const next = cur + (target - cur) * Math.min(1, dt * 5); // 平滑遮挡过渡
    sphere.visMap.set(idx, next);
    return next;
  });
  const w = applyOcclusion(weights, vis);
  return { indices, weights: w, occluded: vis.map((v) => v < 0.5) };
}

// ---------- 路径 ----------
const PATH = { cx: 4.3, cy: 1.35, cz: 4.3, rx: 2.4, rz: 2.4 };
function pathPoint(t, out) {
  out.set(
    PATH.cx + PATH.rx * Math.cos(t),
    PATH.cy,
    PATH.cz + PATH.rz * Math.sin(t)
  );
  return out;
}
function pathNormal(t, out) {
  out.set(PATH.rz * Math.cos(t), 0, PATH.rx * Math.sin(t)).normalize();
  return out;
}

// ---------- UI ----------
let mode = 'compare';
let paused = false;
const rows = [0, 1, 2, 3].map(() => {
  const row = document.createElement('div');
  row.className = 'probe-row';
  row.innerHTML =
    '<span class="pid"></span><div class="bar"><div class="fill"></div></div>' +
    '<span class="pct"></span><span class="expo"></span><span class="occ"></span>';
  document.getElementById('probe-rows').appendChild(row);
  return {
    pid: row.querySelector('.pid'),
    fill: row.querySelector('.fill'),
    pct: row.querySelector('.pct'),
    expo: row.querySelector('.expo'),
    occ: row.querySelector('.occ'),
  };
});

function setMode(next) {
  mode = next;
  document
    .querySelectorAll('#modes button')
    .forEach((b) => b.classList.toggle('on', b.dataset.mode === next));
  const compare = next === 'compare';
  spheres.forEach((s) => {
    s.mesh.visible = compare || s.mode === next;
  });
  document.getElementById('panel-title').textContent = compare
    ? '参与插值的探针（四点插值球）'
    : `参与采样的探针（${MODES[next]}）`;
}
document.querySelectorAll('#modes button').forEach((b) => {
  b.addEventListener('click', () => setMode(b.dataset.mode));
});
document.getElementById('pause').addEventListener('click', (e) => {
  paused = !paused;
  e.target.textContent = paused ? '继续' : '暂停';
});

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let t = 0.6;
const tmpPos = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const COMPARE_OFFSETS = [-1.15, 0, 1.15];

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused) t += dt * 0.45;

  const compare = mode === 'compare';
  spheres.forEach((sphere, i) => {
    if (!sphere.mesh.visible) return;
    pathPoint(t, tmpPos);
    if (compare) {
      pathNormal(t, tmpN);
      tmpPos.addScaledVector(tmpN, COMPARE_OFFSETS[i]);
    }
    sphere.mesh.position.copy(tmpPos);
    sphere.active = assignProbes(sphere, dt);

    const idx4 = [0, 1, 2, 3].map(
      (k) => sphere.active.indices[Math.min(k, sphere.active.indices.length - 1)]
    );
    const w4 = [0, 1, 2, 3].map((k) => sphere.active.weights[k] ?? 0);
    setMaterialProbes(sphere.material, probes, idx4, w4);
  });

  // 焦点球：对比模式下看四点插值球，否则看当前模式球
  const focus = compare ? spheres[2] : spheres.find((s) => s.mode === mode);
  updateFocusViz(focus);
  renderer.render(scene, camera);
}

function updateFocusViz(focus) {
  const activeSet = new Set(focus.active ? focus.active.indices : []);
  probeViz.forEach((m, i) => {
    const on = activeSet.has(i);
    m.scale.setScalar(on ? 2.0 : 1);
    m.material.color.set(on ? 0xffd34d : 0x555a60);
  });

  const posAttr = linkGeo.getAttribute('position');
  const colAttr = linkGeo.getAttribute('color');
  const fp = focus.mesh.position;
  const count = focus.active ? focus.active.indices.length : 0;
  for (let k = 0; k < 4; k++) {
    const used = k < count;
    const idx = used ? focus.active.indices[k] : 0;
    const w = used ? focus.active.weights[k] ?? 0 : 0;
    const occ = used ? focus.active.occluded[k] : false;
    const p = used ? probes[idx].position : [fp.x, fp.y, fp.z];
    posAttr.setXYZ(k * 2, fp.x, fp.y, fp.z);
    posAttr.setXYZ(k * 2 + 1, p[0], p[1], p[2]);
    const alpha = Math.max(w, 0.06);
    const col = occ ? [1, 0.25, 0.25] : [0.3 * alpha, 1 * alpha, 0.5 * alpha];
    colAttr.setXYZ(k * 2, ...col);
    colAttr.setXYZ(k * 2 + 1, ...col);

    const row = rows[k];
    row.pid.parentElement.style.display = used ? '' : 'none';
    if (!used) continue;
    row.pid.textContent = `#${idx}`;
    row.fill.style.width = `${(w * 100).toFixed(1)}%`;
    row.pct.textContent = `${(w * 100).toFixed(1)}%`;
    row.expo.textContent = `曝光 ${probes[idx].exposure.toFixed(3)}`;
    row.occ.textContent = occ ? '遮挡' : '';
    row.occ.className = occ ? 'occ on' : 'occ';
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
}

setMode('compare');
frame();

// 供自动化测试使用
window.__demo = {
  setT: (v) => (t = v),
  setMode,
  pause: (v) => (paused = v),
};
