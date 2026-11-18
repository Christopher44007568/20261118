import * as THREE from 'three';
import { OutlineShader, NormalPassMaterial } from './outline.js';

const MODES = ['composite', 'scene', 'outline'];

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 500);

// ---------- procedural checkerboard texture (interior detail edges) ----------
function checkerTexture(repeat = 8) {
  const size = 256, cell = size / 8;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#c8c8c8' : '#3a3a3a';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}

// ---------- scenes ----------
function buildScene(name) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a5c8);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(5, 10, 7);
  scene.add(sun);

  const checker = checkerTexture(8);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshLambertMaterial({ map: checker })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const mat = (c) => new THREE.MeshLambertMaterial({ map: checkerTexture(2), color: c });

  if (name === 'apart') {
    // two objects very far apart: both silhouettes must be outlined
    const a = new THREE.Mesh(new THREE.SphereGeometry(2, 48, 32), mat(0xff5533));
    a.position.set(-25, 2, 0);
    const b = new THREE.Mesh(new THREE.SphereGeometry(2, 48, 32), mat(0x3377ff));
    b.position.set(25, 2, -15);
    scene.add(a, b);
    camera.position.set(0, 9, 52);
    camera.lookAt(0, 2, -5);
  } else if (name === 'contact') {
    // box and thin slab hugging the ground plane
    const box = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), mat(0xffaa00));
    box.position.set(-3, 2, 0);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 6), mat(0x33cc88));
    slab.position.set(5, 0.1, -2);
    scene.add(box, slab);
    camera.position.set(0, 6, 14);
    camera.lookAt(1, 1, 0);
  } else {
    // occlusion: near box partially hides a taller far box
    const near = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), mat(0xdd3344));
    near.position.set(-0.8, 1.5, 0);
    const far = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 4), mat(0x4466dd));
    far.position.set(0.8, 4, -8);
    scene.add(near, far);
    camera.position.set(0, 3, 10);
    camera.lookAt(0, 2.5, -4);
  }
  return scene;
}

// ---------- render targets ----------
function makeTargets(w, h) {
  const depthTexture = new THREE.DepthTexture(w, h);
  depthTexture.type = THREE.FloatType;
  const colorRT = new THREE.WebGLRenderTarget(w, h, { depthTexture });
  const normalRT = new THREE.WebGLRenderTarget(w, h);
  const maskRT = new THREE.WebGLRenderTarget(w, h);
  return { colorRT, normalRT, maskRT };
}

const fsQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(OutlineShader.uniforms),
    vertexShader: OutlineShader.vertexShader,
    fragmentShader: OutlineShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  })
);
const fsScene = new THREE.Scene();
fsScene.add(fsQuad);
const fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// ---------- app state ----------
const state = {
  sceneName: new URLSearchParams(location.search).get('scene') || 'apart',
  mode: 0,
  scene: null,
  targets: null,
  auto: !new URLSearchParams(location.search).has('test'),
  orbitAngle: 0,
};

function setScene(name) {
  state.sceneName = name;
  state.scene = buildScene(name);
  updateHud(null);
}

function setMode(mode) {
  state.mode = mode;
  fsQuad.material.uniforms.mode.value = mode;
  updateHud(null);
}

function setSize(w, h) {
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (state.targets) Object.values(state.targets).forEach((t) => t.dispose());
  state.targets = makeTargets(w, h);
  fsQuad.material.uniforms.resolution.value.set(w, h);
}

function renderFrame() {
  const { colorRT, normalRT } = state.targets;
  const u = fsQuad.material.uniforms;

  renderer.setRenderTarget(colorRT);
  renderer.render(state.scene, camera);

  state.scene.overrideMaterial = NormalPassMaterial;
  renderer.setRenderTarget(normalRT);
  renderer.render(state.scene, camera);
  state.scene.overrideMaterial = null;

  u.tDepth.value = colorRT.depthTexture;
  u.tNormal.value = normalRT.texture;
  u.tDiffuse.value = colorRT.texture;
  u.cameraNear.value = camera.near;
  u.cameraFar.value = camera.far;
  u.invProjectionMatrix.value.copy(camera.projectionMatrixInverse);

  renderer.setRenderTarget(null);
  renderer.render(fsScene, fsCamera);
}

// Render the binary edge mask into maskRT and read it back.
function readEdgeMask() {
  const { maskRT } = state.targets;
  const u = fsQuad.material.uniforms;
  const prevMode = u.mode.value;
  u.mode.value = 2;
  renderer.setRenderTarget(maskRT);
  renderer.render(fsScene, fsCamera);
  u.mode.value = prevMode;

  const w = maskRT.width, h = maskRT.height;
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(maskRT, 0, 0, w, h, buf);
  return { buf, w, h };
}

function edgeStats() {
  const { buf, w, h } = readEdgeMask();
  const on = (x, y) => buf[(y * w + x) * 4] > 127;
  let count = 0, maxRun = 0, leftCount = 0, maxThickness = 0;
  let hash = 2166136261 >>> 0;
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (on(x, y)) {
        count++; run++;
        if (run > maxRun) maxRun = run;
        if (x < w / 2) leftCount++;
      } else run = 0;
      hash ^= on(x, y) ? 1 : 0;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  // line thickness: for each edge pixel, the shorter of the horizontal and
  // vertical edge runs passing through it (a long line still measures thin)
  const thicknesses = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      let rx = 1, ry = 1;
      for (let i = x - 1; i >= 0 && on(i, y); i--) rx++;
      for (let i = x + 1; i < w && on(i, y); i++) rx++;
      for (let i = y - 1; i >= 0 && on(x, i); i--) ry++;
      for (let i = y + 1; i < h && on(x, i); i++) ry++;
      const t = Math.min(rx, ry);
      if (t > maxThickness) maxThickness = t;
      thicknesses.push(t);
    }
  thicknesses.sort((a, b) => a - b);
  const pct = (p) => thicknesses[Math.min(thicknesses.length - 1, Math.floor(p * thicknesses.length))];
  return { count, maxRun, maxThickness, p50: pct(0.5), p99: pct(0.99), hash, width: w, height: h, leftCount, rightCount: count - leftCount };
}

function edgeCountInRect(nx0, ny0, nx1, ny1) {
  const { buf, w, h } = readEdgeMask();
  const x0 = Math.floor(nx0 * w), x1 = Math.floor(nx1 * w);
  const y0 = Math.floor(ny0 * h), y1 = Math.floor(ny1 * h);
  let count = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (buf[(y * w + x) * 4] > 127) count++;
  return count;
}

function setTextured(on) {
  state.scene.traverse((o) => {
    if (o.isMesh && o.material && 'map' in o.material) {
      if (on) o.material.map = o.userData.savedMap || o.material.map;
      else { o.userData.savedMap = o.material.map; o.material.map = null; }
      o.material.needsUpdate = true;
    }
  });
  renderFrame();
}

// ---------- HUD / interaction ----------
const hud = document.getElementById('hud');
function updateHud(stats) {
  if (!state.targets) return;
  hud.textContent =
    `scene: ${state.sceneName}   mode: ${MODES[state.mode]} (1=composite 2=scene 3=outline)\n` +
    `viewport: ${state.targets.colorRT.width}x${state.targets.colorRT.height}\n` +
    (stats ? `edge pixels: ${stats.count}   max line run: ${stats.maxRun}px` : '');
}

addEventListener('keydown', (e) => {
  if (e.key === '1') setMode(0);
  if (e.key === '2') setMode(1);
  if (e.key === '3') setMode(2);
});
addEventListener('resize', () => setSize(innerWidth, innerHeight));

setScene(state.sceneName);
setSize(innerWidth, innerHeight);

if (state.auto) {
  renderer.setAnimationLoop(() => {
    state.orbitAngle += 0.002;
    const r = Math.hypot(camera.position.x, camera.position.z);
    camera.position.x = r * Math.sin(state.orbitAngle);
    camera.position.z = r * Math.cos(state.orbitAngle);
    camera.lookAt(0, 2, -2);
    renderFrame();
    updateHud(edgeStats());
  });
} else {
  renderFrame();
  updateHud(null);
}

// ---------- headless test API ----------
window.__app = {
  uniforms: fsQuad.material.uniforms,
  setScene: (n) => { setScene(n); renderFrame(); },
  setMode: (m) => { setMode(m); renderFrame(); },
  setSize: (w, h) => { setSize(w, h); renderFrame(); },
  setCamera: (px, py, pz, tx, ty, tz) => {
    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
    renderFrame();
  },
  renderFrame,
  edgeStats,
  edgeCountInRect,
  setTextured,
  readMask: () => {
    const { buf, w, h } = readEdgeMask();
    const mask = new Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = buf[i * 4] > 127 ? 1 : 0;
    return { mask, w, h };
  },
};
