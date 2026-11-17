import { Logger, querySampleSupport } from './glutil.js';
import { MsaaTarget } from './msaa.js';
import { Scene } from './scene.js';
import { CpuTimer, GpuTimer, estimateMemory, formatMiB, formatMs } from './stats.js';
import { PixelInspector, analyzeFrame } from './inspector.js';
import { DepthGuard, createDepthTestProgram } from './depthtest.js';

const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2', { antialias: false });
const logger = new Logger(document.getElementById('log'));

if (!gl) {
  document.getElementById('gl-info').textContent =
    '当前浏览器不支持 WebGL2，演示无法运行。';
  throw new Error('WebGL2 unavailable');
}

const support = querySampleSupport(gl);
document.getElementById('gl-info').textContent =
  `WebGL2 · MAX_SAMPLES=${support.max} · RGBA8 + DEPTH_COMPONENT24`;

document.querySelectorAll('.mode-btn').forEach((btn) => {
  const requested = Number(btn.dataset.samples);
  if (requested > 1 && !support[requested]) {
    btn.disabled = true;
    btn.textContent += '（设备不支持）';
  } else if (requested > 1 && support[requested] !== requested) {
    btn.textContent += `（实际 ${support[requested]}x）`;
  }
});

const scene = new Scene(gl);
const cpuTimer = new CpuTimer();
const gpuTimer = new GpuTimer(gl);
const inspector = new PixelInspector(
  document.getElementById('inspector'),
  document.getElementById('pixel-info')
);
const guard = new DepthGuard(gl, logger);

const state = {
  samples: 1,
  target: null,
  paused: false,
  bugMode: false,
  time: 0,
  shapeBaseline: null,
  mouse: { inside: false, x: 0, y: 0 },
  memBaseline: null,
};

function resizeIfNeeded() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = 900, cssH = 640;
  const w = Math.floor(cssW * dpr);
  const h = Math.floor(cssH * dpr);
  if (canvas.width === w && canvas.height === h && state.target) return false;
  canvas.width = w;
  canvas.height = h;
  rebuildTarget(w, h, state.samples);
  return true;
}

function switchSamples(samples) {
  state.samples = samples;
  if (state.bugMode) {
    state.bugMode = false;
    const bugBtn = document.getElementById('btn-bug');
    bugBtn.classList.remove('active');
    bugBtn.textContent = '模拟深度不清除（故障）';
  }
  rebuildTarget(canvas.width, canvas.height, samples);
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.samples) === samples);
  });
  const actual = state.actualSamples;
  const note = samples > 1
    ? `（multisample renderbuffer + blit resolve${actual !== samples ? `，驱动提升至 ${actual}x` : ''}）`
    : '（直接渲染到纹理）';
  logger.log(`切换到 ${samples}x 采样${note}`);
}

function rebuildTarget(w, h, samples) {
  if (state.target) state.target.destroy(gl);
  const actualSamples = samples > 1 ? (support[samples] || samples) : 1;
  state.target = new MsaaTarget(gl, w, h, samples, actualSamples);
  state.actualSamples = actualSamples;
  if (state.memBaseline === null) {
    state.memBaseline = estimateMemory(w, h, 1).totalBytes;
  }
  updateMemoryPanel();
  updateStructuralBadges();
  logger.log(`重建渲染目标 ${w}×${h}，请求 ${samples}x，实际 ${actualSamples}x`);
}

function updateMemoryPanel() {
  const actual = state.actualSamples || state.samples;
  const mem = estimateMemory(canvas.width, canvas.height, actual);
  document.getElementById('mem-ms-color').textContent =
    actual > 1 ? formatMiB(mem.msColorBytes) : '不适用（1x 直渲纹理）';
  document.getElementById('mem-ms-depth').textContent = formatMiB(mem.msDepthBytes);
  document.getElementById('mem-color-tex').textContent = formatMiB(mem.colorTextureBytes);
  const baseline = state.memBaseline || estimateMemory(canvas.width, canvas.height, 1).totalBytes;
  const ratio = (mem.totalBytes / baseline).toFixed(2);
  document.getElementById('mem-total').textContent =
    `${formatMiB(mem.totalBytes)}（×${ratio} vs 1x）`;
}

function updateStructuralBadges() {
  const result = guard.structuralChecks(state.target);
  const depthBadge = document.getElementById('chk-resolve-depth');
  depthBadge.textContent = result.depthLeakRisk ? '失败' : '通过';
  depthBadge.className = 'badge ' + (result.depthLeakRisk ? 'fail' : 'pass');
  depthBadge.title = state.samples > 1
    ? 'MSAA：resolve FBO 仅挂颜色纹理，深度留在几何 FBO'
    : '1x：几何/resolve 共用 FBO，深度附件不会进入纹理';
  const fboBadge = document.getElementById('chk-fbo-status');
  fboBadge.textContent = result.fboOk ? '通过' : '失败';
  fboBadge.className = 'badge ' + (result.fboOk ? 'pass' : 'fail');
  fboBadge.title = `几何FBO: ${result.geometryStatus} / resolveFBO: ${result.resolveStatus}`;
}

let lastTs = performance.now();
let depthClearedThisFrame = false;
let lastPauseState = false;

function frame(ts) {
  if (state.paused !== lastPauseState) {
    // 暂停/恢复瞬间不累积时间差，避免恢复后动画跳变。
    lastTs = ts;
    lastPauseState = state.paused;
  }
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;
  if (!state.paused) state.time += dt;

  const target = state.target;
  gpuTimer.begin();

  cpuTimer.mark('geometry');
  // 关键纪律：每帧几何渲染前必须清除深度；故障模式下故意不清除以复现深度泄漏。
  const clearDepth = !state.bugMode;
  depthClearedThisFrame = clearDepth;
  scene.drawGeometry(target, state.time, { clearDepth });
  const geometryMs = cpuTimer.since('geometry');

  cpuTimer.mark('resolve');
  target.resolve(gl);
  const resolveMs = cpuTimer.since('resolve');

  cpuTimer.mark('present');
  scene.drawPresent(target, canvas.width, canvas.height);
  const presentMs = cpuTimer.since('present');

  gpuTimer.end();
  const gpuMs = gpuTimer.poll();
  const totalMs = geometryMs + resolveMs + presentMs;

  document.getElementById('ft-total').textContent = formatMs(totalMs);
  document.getElementById('ft-geometry').textContent = formatMs(geometryMs);
  document.getElementById('ft-resolve').textContent =
    state.samples > 1 ? formatMs(resolveMs) : '跳过（1x 无需 resolve）';
  document.getElementById('ft-present').textContent = formatMs(presentMs);
  document.getElementById('ft-gpu').textContent =
    gpuMs !== null ? formatMs(gpuMs) :
      (gpuTimer.available ? '等待查询…' : '扩展不可用（仅 CPU 计时）');

  const clearBadge = document.getElementById('chk-depth-clear');
  clearBadge.textContent = depthClearedThisFrame ? '通过' : '故障';
  clearBadge.className = 'badge ' + (depthClearedThisFrame ? 'pass' : 'fail');

  if (state.mouse.inside) {
    inspector.update(gl, target, state.mouse.x, state.mouse.y);
  } else if (inspector.locked) {
    inspector.update(gl, target, inspector.locked.x, inspector.locked.y);
  }
  requestAnimationFrame(frame);
}

function runShapeAnalysis() {
  const fixedTime = 3.217;
  scene.renderStaticFrame(state.target, fixedTime);
  const stats = analyzeFrame(gl, state.target);
  document.getElementById('shape-bg').textContent = stats.background.toLocaleString();
  document.getElementById('shape-fg').textContent = stats.foreground.toLocaleString();
  document.getElementById('shape-edge').textContent = stats.edge.toLocaleString();
  document.getElementById('shape-mass').textContent = stats.mass.toFixed(0);
  if (state.shapeBaseline === null) {
    state.shapeBaseline = stats.mass;
    state.shapeBaselineTime = fixedTime;
    document.getElementById('shape-delta').textContent = '基准（当前模式）';
  } else {
    // 所有模式都用同一个 fixedTime 渲染，因此基准可跨采样模式直接对比。
    const delta = (stats.mass - state.shapeBaseline) / state.shapeBaseline * 100;
    document.getElementById('shape-delta').textContent =
      `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}%`;
  }
  logger.log(`形状分析：边缘=${stats.edge} 像素，覆盖质量=${stats.mass.toFixed(0)}`);
}

function runDepthBehaviorTest() {
  const programInfo = createDepthTestProgram(gl);
  const result = guard.runBehaviorTest(programInfo);
  gl.deleteProgram(programInfo.program);
  const el = document.getElementById('depth-test-result');
  el.classList.remove('muted');
  if (result.correctVisible && result.leakedWrong) {
    el.innerHTML =
      `正确清除：中心=(${result.correct.join(',')}) 绿色可见<br>` +
      `不清除：中心=(${result.leaked.join(',')}) 被上一帧残留深度错误遮挡<br>` +
      `<b style="color:#8fd99a">结论：每帧清深度是必需的，resolve 纹理本身不携带深度。</b>`;
    logger.log('深度行为测试通过：残留深度会错误遮挡下一帧', 'warn');
  } else {
    el.textContent = '测试结果异常，请检查驱动行为。';
    logger.log('深度行为测试结果异常', 'err');
  }
}

// ---- UI 事件 ----
document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    switchSamples(Number(btn.dataset.samples));
  });
});

document.getElementById('btn-pause').addEventListener('click', (e) => {
  state.paused = !state.paused;
  e.target.textContent = state.paused ? '继续旋转' : '暂停旋转';
});

document.getElementById('btn-bug').addEventListener('click', (e) => {
  state.bugMode = !state.bugMode;
  e.target.classList.toggle('active', state.bugMode);
  if (state.bugMode) {
    logger.log('故障模式开启：第二帧起跳过 DEPTH_BUFFER_BIT 清除，观察残影/错误遮挡', 'err');
  } else {
    logger.log('故障模式关闭：恢复每帧深度清除');
  }
});

document.getElementById('btn-depth-test').addEventListener('click', runDepthBehaviorTest);
document.getElementById('btn-shape').addEventListener('click', runShapeAnalysis);

window.addEventListener('resize', () => resizeIfNeeded());

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  state.mouse.x = Math.floor((e.clientX - rect.left) / rect.width * canvas.width);
  const cssY = Math.floor((e.clientY - rect.top) / rect.height * canvas.height);
  state.mouse.y = canvas.height - 1 - cssY;
  state.mouse.inside = true;
});
canvas.addEventListener('mouseleave', () => {
  state.mouse.inside = false;
  inspector.hover = null;
});
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const cssX = Math.floor((e.clientX - rect.left) / rect.width * canvas.width);
  const cssY = Math.floor((e.clientY - rect.top) / rect.height * canvas.height);
  inspector.locked = {
    x: cssX,
    y: canvas.height - 1 - cssY,
  };
  logger.log(`锁定检查点 画布坐标(${cssX}, ${cssY})`);
});

document.getElementById('max-samples').textContent =
  `设备最大采样数：${support.max}；硬件支持档位=[${support.rawSupported.join(', ')}]；` +
  `请求 2x→实际 ${support[2] || '不支持'}x，请求 4x→实际 ${support[4] || '不支持'}x`;

resizeIfNeeded();
updateMemoryPanel();
updateStructuralBadges();
inspector.clear();
logger.log('初始化完成：默认 1x，几何 FBO → resolve 纹理 → 全屏上屏');
requestAnimationFrame(frame);

// 调试/自动化钩子：便于控制台或测试脚本检查内部状态。
window.__msaaDebug = {
  getState: () => state,
  getTarget: () => state.target,
  gl,
};
