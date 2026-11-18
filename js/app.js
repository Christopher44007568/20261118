// 应用入口：初始化 WebGPU、主循环、鼠标拾取调度、HUD 与测试钩子

import { buildDefaultScene } from './scene.js';
import { Camera, cpuPick } from './cpu-picker.js';
import { GpuRenderer } from './gpu.js';
import { PickManager } from './picking.js';

const canvas = document.getElementById('gpu-canvas');
const hud = document.getElementById('hud');

export const state = {
  device: null,
  renderer: null,
  picker: null,
  scene: null,
  camera: new Camera(),
  canvas,
  selection: null,
  mouse: { cssX: 0, cssY: 0, inside: false, dirty: false },
  resizes: 0,
  frames: 0,
  staleViolation: false,
  ready: false,
};

async function init() {
  if (!navigator.gpu) throw new Error('WebGPU 不可用');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('未获取到 WebGPU adapter');
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (ev) => {
    console.error('WebGPU uncapturederror:', ev.error.message);
    (window.__GPU_ERRORS__ = window.__GPU_ERRORS__ || []).push(ev.error.message);
  });
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  state.device = device;
  state.context = context;
  state.renderer = new GpuRenderer(device, format);
  state.picker = new PickManager(device, 4);
  state.scene = buildDefaultScene();

  canvas.addEventListener('pointermove', (ev) => {
    state.mouse.cssX = ev.clientX;
    state.mouse.cssY = ev.clientY;
    state.mouse.inside = true;
    state.mouse.dirty = true;
  });
  canvas.addEventListener('pointerleave', () => {
    state.mouse.inside = false;
  });

  state.ready = true;
  requestAnimationFrame(frame);
}

// CSS 坐标 -> 设备像素：按画布实际像素尺寸与 CSS 盒尺寸比例换算，自动覆盖 DPR 与缩放
export function cssToDevice(cssX, cssY) {
  const rect = canvas.getBoundingClientRect();
  const px = Math.floor(((cssX - rect.left) / rect.width) * canvas.width);
  const py = Math.floor(((cssY - rect.top) / rect.height) * canvas.height);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
  return { px, py };
}

function resizeIfNeeded() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (w !== canvas.width || h !== canvas.height) {
    canvas.width = w;
    canvas.height = h;
    state.renderer.ensureTargets(w, h);
    state.resizes++;
  }
}

function onHit(hit) {
  if (hit && !state.scene.getObject(hit.objectId)) {
    state.staleViolation = true;
    return;
  }
  state.selection = hit;
}

function frame() {
  const { renderer, picker, scene, camera, device, context } = state;
  resizeIfNeeded();
  renderer.syncScene(scene);

  const { viewProj } = camera.matrices(canvas.width / canvas.height);
  renderer.updateCamera(viewProj, state.selection);

  let request = null;
  if (state.mouse.inside && state.mouse.dirty) {
    const pt = cssToDevice(state.mouse.cssX, state.mouse.cssY);
    state.mouse.dirty = false;
    if (pt) {
      picker.stats.requests++;
      request = {
        ...pt,
        version: scene.version,
        submitTime: performance.now(),
        cpu: cpuPick(scene, camera, pt.px, pt.py, canvas.width, canvas.height),
      };
    }
  }

  const encoder = device.createCommandEncoder();
  renderer.render(encoder, context, !!request);
  let entry = null;
  if (request) entry = picker.encodePick(encoder, renderer.idTexture, request);
  device.queue.submit([encoder.finish()]);
  if (entry) picker.resolve(entry, request, scene, onHit);

  // 测试钩子：回读可见画面像素，验证 ID 通道与可见画面一致
  if (state.captureRequest) {
    const cap = state.captureRequest;
    state.captureRequest = null;
    const capBuf = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const capEnc = device.createCommandEncoder();
    capEnc.copyTextureToBuffer(
      { texture: context.getCurrentTexture(), origin: { x: cap.px, y: cap.py } },
      { buffer: capBuf, bytesPerRow: 256, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 }
    );
    device.queue.submit([capEnc.finish()]);
    capBuf.mapAsync(GPUMapMode.READ).then(() => {
      state.lastCapture = { key: cap.key, rgba: Array.from(new Uint8Array(capBuf.getMappedRange().slice(0, 4))) };
      capBuf.unmap();
      capBuf.destroy();
    }).catch(() => {});
  }

  // 测试钩子：在本帧提交之后、mapAsync 解析之前删除对象，
  // 保证存在携带旧场景版本的在途请求，用于验证旧结果被丢弃
  if (state.deleteAfterSubmit) {
    scene.deleteObject(state.deleteAfterSubmit);
    state.deleteAfterSubmit = 0;
  }

  state.frames++;
  updateHud();
  requestAnimationFrame(frame);
}

function updateHud() {
  const s = state.picker.stats;
  const avg = s.resolved ? (s.totalLatencyMs / s.resolved).toFixed(2) : '0.00';
  const sel = state.selection
    ? `obj${state.selection.objectId}#inst${state.selection.instanceId}`
    : '(背景)';
  hud.textContent = [
    `选中: ${sel} | 场景版本: ${state.scene.version} | DPR: ${window.devicePixelRatio} | 画布: ${canvas.width}x${canvas.height}`,
    `请求: ${s.requests} 提交: ${s.submitted} 有效命中: ${s.validHits} 背景: ${s.backgroundHits} 丢弃: ${s.discarded} 池满丢弃: ${s.droppedNoBuffer}`,
    `延迟: 最近 ${s.lastLatencyMs.toFixed(2)}ms 平均 ${avg}ms 最大 ${s.maxLatencyMs.toFixed(2)}ms | 在途: ${state.picker.inFlight}`,
    `缓冲池: 创建 ${s.poolCreated} 复用 ${s.poolReused} | GPU/CPU 不一致: ${s.mismatches} | resize: ${state.resizes}`,
  ].join('\n');
}

init().catch((err) => {
  hud.textContent = `初始化失败: ${err.message}`;
  window.__INIT_ERROR__ = err.message;
});

if (new URLSearchParams(location.search).has('test')) {
  import('./test-driver.js').then((m) => m.runTest(state));
}
