// Boot, UI wiring, scenario driver, and the window.__mb test API.
import { Pipeline } from './pipeline.js';
import { buildScene } from './scene.js';

const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2', {
  antialias: false, depth: false, preserveDrawingBuffer: true,
});
if (!gl) throw new Error('WebGL2 unavailable');

const W = canvas.width, H = canvas.height;
const pipeline = new Pipeline(gl, W, H);
const scene = buildScene(gl);

const VIEW_MODES = { composite: 0, velocity: 1, blur: 2, history: 3, split: 4 };
const state = { scenario: 'static', view: 'composite', paused: false };

function setScenario(name) {
  state.scenario = name;
  pipeline.reset();
  document.querySelectorAll('#scenario-row button[data-scenario]').forEach((b) =>
    b.classList.toggle('active', b.dataset.scenario === name));
}

function setView(name) {
  state.view = name;
  pipeline.viewMode = VIEW_MODES[name];
  document.getElementById('view-label').textContent = name.toUpperCase();
  document.querySelectorAll('#view-row button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name));
}

document.querySelectorAll('#scenario-row button[data-scenario]').forEach((b) =>
  b.addEventListener('click', () => setScenario(b.dataset.scenario)));
document.querySelectorAll('#view-row button').forEach((b) =>
  b.addEventListener('click', () => setView(b.dataset.view)));
document.getElementById('pause-btn').addEventListener('click', (e) => {
  state.paused = !state.paused;
  e.target.classList.toggle('active', state.paused);
});

function stepFrame() {
  pipeline.renderFrame(scene, state.scenario);
  pipeline.present();
  if (pipeline.frameIndex % 15 === 0) updateFrameState();
}

function updateFrameState() {
  const s = computeStats();
  const occ = s.visibility.lowFraction > 0.001 ? 'shortened' : 'clear';
  document.getElementById('frame-state').textContent =
    `Motion ${s.total.averagePx.toFixed(1)} px · History ` +
    `${Math.round(s.history.average * 100)}% · Occlusion ${occ}`;
}

function loop() {
  if (!state.paused) stepFrame();
  requestAnimationFrame(loop);
}
setScenario('static');
setView('composite');
requestAnimationFrame(loop);

function readFbo(fbo, attachment, format, type, ArrayType, channels) {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
  gl.readBuffer(attachment);
  const out = new ArrayType(W * H * channels);
  gl.readPixels(0, 0, W, H, format, type, out);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  return out;
}

function computeStats() {
  const vel = readFbo(pipeline.fboG, gl.COLOR_ATTACHMENT1, gl.RGBA, gl.FLOAT, Float32Array, 4);
  const ids = readFbo(pipeline.fboG, gl.COLOR_ATTACHMENT2, gl.RED, gl.UNSIGNED_BYTE, Uint8Array, 1);
  const vis = readFbo(pipeline.fboVis, gl.COLOR_ATTACHMENT0, gl.RED, gl.UNSIGNED_BYTE, Uint8Array, 1);
  const blur = readFbo(pipeline.fboBlur, gl.COLOR_ATTACHMENT0, gl.RGBA, gl.FLOAT, Float32Array, 4);
  const res = readFbo(pipeline.fboResolve, gl.COLOR_ATTACHMENT0, gl.RGBA, gl.FLOAT, Float32Array, 4);
  const total = { sum: 0, max: 0 }, cam = { sum: 0, max: 0 };
  const obj = { sum: 0, max: 0, count: 0 }, bg = { sum: 0, max: 0, count: 0 };
  const fan = { sum: 0, max: 0, count: 0, camSum: 0, objSum: 0, objCount: 0 };
  const hist = { sum: 0, min: 1, max: 0 };
  const visM = { sum: 0, low: 0 };
  const range = { sum: 0, min: 1, shortened: 0 };
  const MAXB = 24;
  for (let i = 0; i < W * H; i++) {
    const cx = vel[i * 4], cy = vel[i * 4 + 1];
    const ox = vel[i * 4 + 2], oy = vel[i * 4 + 3];
    const cl = Math.hypot(cx, cy), ol = Math.hypot(ox, oy);
    const tl = Math.hypot(cx + ox, cy + oy);
    total.sum += tl; total.max = Math.max(total.max, tl);
    cam.sum += cl; cam.max = Math.max(cam.max, cl);
    obj.sum += ol; obj.max = Math.max(obj.max, ol);
    if (ol > 0.5) obj.count++;
    if (ids[i] > 128) { // id 1.0 stored in normalized R8 reads back as 255
      fan.count++; fan.sum += tl; fan.max = Math.max(fan.max, tl);
      fan.camSum += cl; fan.objSum += ol;
      if (ol > 0.5) fan.objCount++;
    } else {
      bg.sum += tl; bg.max = Math.max(bg.max, tl); bg.count++;
    }
    const hw = res[i * 4 + 3];
    hist.sum += hw; hist.min = Math.min(hist.min, hw); hist.max = Math.max(hist.max, hw);
    const v = vis[i] / 255;
    visM.sum += v; if (v < 0.5) visM.low++;
    const r = blur[i * 4 + 3];
    range.sum += r; range.min = Math.min(range.min, r);
    const expected = Math.min(tl, MAXB) / MAXB;
    if (r < expected * 0.9 - 0.01) range.shortened++;
  }
  const n = W * H;
  return {
    scenario: state.scenario, frameCount: pipeline.frameIndex, resolution: [W, H],
    width: W, height: H, pixelCount: n,
    total: { averagePx: total.sum / n, maxPx: total.max },
    camera: { averagePx: cam.sum / n, maxPx: cam.max },
    object: { averagePx: obj.sum / n, maxPx: obj.max, pixelCount: obj.count },
    background: { averagePx: bg.count ? bg.sum / bg.count : 0, maxPx: bg.max },
    fan: {
      averagePx: fan.count ? fan.sum / fan.count : 0, maxPx: fan.max,
      cameraAveragePx: fan.count ? fan.camSum / fan.count : 0,
      objectAveragePx: fan.count ? fan.objSum / fan.count : 0,
      pixelCount: fan.count,
    },
    history: { average: hist.sum / n, minimum: hist.min, maximum: hist.max },
    visibility: { average: visM.sum / n, lowFraction: visM.low / n },
    blurRange: {
      average: range.sum / n, minimum: range.min,
      shortenedFraction: range.shortened / n,
    },
    fanObjectPixelCount: fan.objCount,
  };
}

function hudInfo() {
  const hud = document.getElementById('hud');
  const cs = getComputedStyle(hud);
  const r = hud.getBoundingClientRect();
  return {
    element: hud.tagName,
    canvasSibling: hud.previousElementSibling === canvas,
    filter: cs.filter, mixBlendMode: cs.mixBlendMode, opacity: cs.opacity,
    pointerEvents: cs.pointerEvents,
    bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
    text: hud.innerText.replace(/\s+/g, ' ').trim(),
    sampledByBlurShader: false,
    drawOrder: 'DOM overlay after composite',
  };
}

// Prove the HUD is not part of the GL pipeline: canvas pixels must be
// bit-identical with the HUD visible and hidden.
function canvasHudIsolation() {
  const hud = document.getElementById('hud');
  const read = () => {
    pipeline.present();
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const a = read();
  hud.style.display = 'none';
  const b = read();
  hud.style.display = '';
  pipeline.present();
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return { identical: diff === 0, differingBytes: diff };
}

function fanScreenPos() {
  const p = scene.fanWorldPos;
  const m = pipeline.prevViewProj;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return {
    x: (x / w * 0.5 + 0.5) * window.innerWidth,
    y: (1 - (y / w * 0.5 + 0.5)) * window.innerHeight,
  };
}

window.__mb = {
  ready: true,
  floatReadOK: pipeline.floatReadOK,
  gl, pipeline,
  setScenario, setView,
  pause(v) { state.paused = v; },
  step(n) { for (let i = 0; i < n; i++) stepFrame(); },
  stats: computeStats,
  hudInfo, canvasHudIsolation, fanScreenPos,
};
