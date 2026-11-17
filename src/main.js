import * as THREE from '../vendor/three.module.js';
import {
  CHUNK_SIZE, WORLD_CHUNKS, WORLD_SIZE, LEVELS,
  terrainHeight, trianglesForLevel, RESOLUTIONS,
} from './terrain.js';
import {
  computeLevels, computeMorphT, edgeUniformsFor, buildLevelTemplate,
} from './lod.js';
import { TERRAIN_VERT, TERRAIN_FRAG, WIREFRAME_FRAG } from './glsl.js';
import { valleyPath, ridgePath } from './tour.js';

const FOG_COLOR = new THREE.Color(0x9db8cc);
const LEVEL_COLORS = [0x37d67a, 0xa3d635, 0xf5a623, 0xe94f37];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = FOG_COLOR.clone();

const camera = new THREE.PerspectiveCamera(
  65, window.innerWidth / window.innerHeight, 0.5, 4000);
camera.position.set(WORLD_SIZE / 2, 230, WORLD_SIZE * 0.9);
camera.lookAt(WORLD_SIZE / 2, 40, WORLD_SIZE / 2);

// --- shared per-level geometry templates (chunk-local) ---
const levelGeometries = [];
for (let l = 0; l < LEVELS; l++) {
  const tpl = buildLevelTemplate(l);
  const g = new THREE.BufferGeometry();
  g.setAttribute('aPos', new THREE.BufferAttribute(tpl.pos, 2));
  g.setAttribute('aMorphA', new THREE.BufferAttribute(tpl.morphA, 2));
  g.setAttribute('aMorphB', new THREE.BufferAttribute(tpl.morphB, 2));
  g.setIndex(new THREE.BufferAttribute(tpl.index, 1));
  levelGeometries.push(g);
}

function sharedUniforms() {
  return {
    uOffset: { value: new THREE.Vector2() },
    uMorphT: { value: 0 },
    uStep: { value: 8 },
    uEdgeT: { value: new THREE.Vector4(1, 1, 1, 1) },
    uEdgeMode: { value: [0, 0, 0, 0] },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uCamPos: { value: new THREE.Vector3() },
    uFogColor: { value: FOG_COLOR.clone() },
    uFogNear: { value: 500 },
    uFogFar: { value: 1600 },
  };
}

function makeTerrainMaterial() {
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
    uniforms: sharedUniforms(),
  });
  return m;
}

function makeWireMaterial() {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: TERRAIN_VERT,
    fragmentShader: WIREFRAME_FRAG,
    wireframe: true,
    uniforms: { ...sharedUniforms(), uColor: { value: new THREE.Color(0x101018) } },
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

// --- chunks ---
const chunks = [];
const chunkGroup = new THREE.Group();
scene.add(chunkGroup);
for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
  for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
    const mat = makeTerrainMaterial();
    const wireMat = makeWireMaterial();
    mat.uniforms.uOffset.value.set(cx * CHUNK_SIZE, cz * CHUNK_SIZE);
    wireMat.uniforms.uOffset.value.set(cx * CHUNK_SIZE, cz * CHUNK_SIZE);
    const mesh = new THREE.Mesh(levelGeometries[3], mat);
    const wire = new THREE.Mesh(levelGeometries[3], wireMat);
    wire.visible = false;
    mesh.frustumCulled = false;
    wire.frustumCulled = false;
    chunkGroup.add(mesh);
    chunkGroup.add(wire);
    chunks.push({ cx, cz, mesh, wire, mat, wireMat, level: -1 });
  }
}

// --- LOD update ---
let levels = computeLevels(camera.position.x, camera.position.y, camera.position.z);
let totalTris = 0;

function updateLOD() {
  levels = computeLevels(camera.position.x, camera.position.y, camera.position.z);
  totalTris = 0;
  const morphTs = new Float32Array(WORLD_CHUNKS * WORLD_CHUNKS);
  for (const c of chunks) {
    const i = c.cz * WORLD_CHUNKS + c.cx;
    morphTs[i] = computeMorphT(
      camera.position.x, camera.position.y, camera.position.z,
      c.cx, c.cz, levels[i]);
  }
  for (const c of chunks) {
    const i = c.cz * WORLD_CHUNKS + c.cx;
    const level = levels[i];
    const t = morphTs[i];
    const edge = edgeUniformsFor(levels, morphTs, c.cx, c.cz);
    if (c.level !== level) {
      c.level = level;
      c.mesh.geometry = levelGeometries[level];
      c.wire.geometry = levelGeometries[level];
      c.wireMat.uniforms.uColor.value.setHex(LEVEL_COLORS[level]);
      const step = CHUNK_SIZE / RESOLUTIONS[level];
      c.mat.uniforms.uStep.value = step;
      c.wireMat.uniforms.uStep.value = step;
    }
    c.mat.uniforms.uMorphT.value = t;
    c.wireMat.uniforms.uMorphT.value = t;
    c.mat.uniforms.uEdgeT.value.set(...edge.t);
    c.wireMat.uniforms.uEdgeT.value.set(...edge.t);
    c.mat.uniforms.uEdgeMode.value = edge.mode.slice();
    c.wireMat.uniforms.uEdgeMode.value = edge.mode.slice();
    c.mat.uniforms.uCamPos.value.copy(camera.position);
    totalTris += trianglesForLevel(level);
  }
}

// --- fly controls ---
const keys = new Set();
let yaw = 0, pitch = -0.3;
const canvas = renderer.domElement;
canvas.addEventListener('click', () => { if (mode === 'free') canvas.requestPointerLock(); });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.0022;
  pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0022));
});
document.addEventListener('keydown', (e) => keys.add(e.code));
document.addEventListener('keyup', (e) => keys.delete(e.code));

function flyStep(dt) {
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 260 : 80;
  const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = new THREE.Vector3();
  if (keys.has('KeyW')) move.add(fwd);
  if (keys.has('KeyS')) move.sub(fwd);
  if (keys.has('KeyD')) move.add(right);
  if (keys.has('KeyA')) move.sub(right);
  if (keys.has('Space') || keys.has('KeyR')) move.y += 1;
  if (keys.has('KeyC') || keys.has('KeyF')) move.y -= 1;
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * dt);
    camera.position.add(move);
  }
  camera.position.x = Math.max(4, Math.min(WORLD_SIZE - 4, camera.position.x));
  camera.position.z = Math.max(4, Math.min(WORLD_SIZE - 4, camera.position.z));
  const ground = terrainHeight(camera.position.x, camera.position.z) + 2.5;
  if (camera.position.y < ground) camera.position.y = ground;
  camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
}

// --- tours ---
let mode = 'free';
let tour = null;
const tours = { valley: null, ridge: null };
function getTour(name) {
  if (!tours[name]) {
    const pts = name === 'valley' ? valleyPath() : ridgePath();
    tours[name] = { pts, offset: name === 'valley' ? 9 : 45, speed: name === 'valley' ? 42 : 70 };
  }
  return tours[name];
}
function startTour(name) {
  mode = name;
  tour = { ...getTour(name), dist: 0 };
  document.exitPointerLock?.();
  setModeLabel();
}
function tourStep(dt) {
  const { pts, offset, speed } = tour;
  tour.dist += speed * dt;
  let acc = 0, i = 0;
  while (i < pts.length - 2) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (acc + seg >= tour.dist) break;
    acc += seg; i++;
  }
  if (i >= pts.length - 2) { mode = 'free'; setModeLabel(); return; }
  const segLen = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  const f = Math.min(1, (tour.dist - acc) / Math.max(segLen, 1e-6));
  const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
  const z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
  camera.position.set(x, terrainHeight(x, z) + offset, z);
  const la = pts[Math.min(i + 3, pts.length - 1)];
  camera.lookAt(la[0], terrainHeight(la[0], la[1]) + offset * 0.4, la[1]);
}

// --- UI ---
const $ = (id) => document.getElementById(id);
const tooltip = $('tooltip');
const minimap = $('minimap');
const mmCtx = minimap.getContext('2d');
const cell = minimap.width / WORLD_CHUNKS;

$('wireToggle').addEventListener('change', (e) => {
  for (const c of chunks) c.wire.visible = e.target.checked;
});
$('tourValley').addEventListener('click', () => startTour('valley'));
$('tourRidge').addEventListener('click', () => startTour('ridge'));
$('tourFree').addEventListener('click', () => { mode = 'free'; setModeLabel(); });

function setModeLabel() {
  $('modeLabel').textContent =
    mode === 'valley' ? '山谷巡游中…' : mode === 'ridge' ? '山脊巡游中…' : '自由飞行（点击画面锁定鼠标）';
}
setModeLabel();

minimap.addEventListener('mousemove', (e) => {
  const r = minimap.getBoundingClientRect();
  const cx = Math.floor((e.clientX - r.left) / r.width * WORLD_CHUNKS);
  const cz = Math.floor((e.clientY - r.top) / r.height * WORLD_CHUNKS);
  if (cx < 0 || cz < 0 || cx >= WORLD_CHUNKS || cz >= WORLD_CHUNKS) {
    tooltip.style.display = 'none';
    return;
  }
  const level = levels[cz * WORLD_CHUNKS + cx];
  tooltip.style.display = 'block';
  tooltip.style.left = `${e.clientX + 14}px`;
  tooltip.style.top = `${e.clientY + 10}px`;
  tooltip.innerHTML =
    `块 (${cx}, ${cz})<br>等级 LOD ${level}<br>` +
    `三角形 ${trianglesForLevel(level).toLocaleString()}`;
});
minimap.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

function drawMinimap() {
  for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
    for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
      const l = levels[cz * WORLD_CHUNKS + cx];
      mmCtx.fillStyle = `#${LEVEL_COLORS[l].toString(16).padStart(6, '0')}`;
      mmCtx.fillRect(cx * cell, cz * cell, cell, cell);
    }
  }
  mmCtx.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i <= WORLD_CHUNKS; i++) {
    mmCtx.beginPath(); mmCtx.moveTo(i * cell, 0); mmCtx.lineTo(i * cell, minimap.height); mmCtx.stroke();
    mmCtx.beginPath(); mmCtx.moveTo(0, i * cell); mmCtx.lineTo(minimap.width, i * cell); mmCtx.stroke();
  }
  const px = camera.position.x / WORLD_SIZE * minimap.width;
  const pz = camera.position.z / WORLD_SIZE * minimap.height;
  mmCtx.fillStyle = '#ffffff';
  mmCtx.beginPath(); mmCtx.arc(px, pz, 4, 0, Math.PI * 2); mmCtx.fill();
  mmCtx.strokeStyle = '#000'; mmCtx.stroke();
}

function updateStats() {
  const counts = [0, 0, 0, 0];
  for (const l of levels) counts[l]++;
  let html = '';
  for (let l = 0; l < LEVELS; l++) {
    html += `<div><span class="sw" style="background:#${LEVEL_COLORS[l].toString(16).padStart(6, '0')}"></span>` +
      `LOD ${l}: ${counts[l]} 块 × ${trianglesForLevel(l).toLocaleString()} 三角</div>`;
  }
  const hi = trianglesForLevel(0), lo = trianglesForLevel(LEVELS - 1);
  html += `<hr><div>场景三角形总计: ${totalTris.toLocaleString()}</div>`;
  html += `<div>最高细节(LOD0): ${hi.toLocaleString()} / 块</div>`;
  html += `<div>最低细节(LOD3): ${lo.toLocaleString()} / 块</div>`;
  html += `<div>细节差: ${(hi - lo).toLocaleString()} 三角 (${(hi / lo).toFixed(0)}×)</div>`;
  $('levelStats').innerHTML = html;
  const p = camera.position;
  $('camInfo').textContent =
    `相机 (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})  ` +
    `离地 ${(p.y - terrainHeight(p.x, p.z)).toFixed(1)}`;
}

// --- main loop ---
const clock = new THREE.Clock();
let uiTimer = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mode === 'free') flyStep(dt);
  else tourStep(dt);
  updateLOD();
  uiTimer += dt;
  if (uiTimer > 0.2) { uiTimer = 0; updateStats(); drawMinimap(); }
  renderer.render(scene, camera);
}
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
animate();
