// Entry point: capability detection, profiler/renderer wiring, HUD, pause.

import { GpuProfiler } from './profiler.js';
import { Renderer, PASS_NAMES } from './renderer.js';

async function init() {
  const hud = document.getElementById('hud');
  const note = document.getElementById('capability');
  if (!navigator.gpu) {
    note.textContent = 'WebGPU is not available in this browser.';
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    note.textContent = 'No WebGPU adapter found.';
    return;
  }

  const supportsTimestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: supportsTimestamps ? ['timestamp-query'] : [],
  });

  const canvas = document.getElementById('gpu');
  const context = canvas.getContext('webgpu');
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

  const profiler = new GpuProfiler({
    device, passNames: PASS_NAMES, gpuTimestamps: supportsTimestamps,
  });
  const renderer = new Renderer({ device, context, canvasFormat, profiler });

  note.textContent = profiler.capabilityNote;
  note.className = supportsTimestamps ? 'ok' : 'warn';

  let paused = false;
  const pauseBtn = document.getElementById('pause');
  const setPaused = (value) => {
    paused = value;
    profiler.setPaused(value);
    pauseBtn.textContent = value ? 'Resume' : 'Pause';
  };
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
  });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  let lastHudUpdate = 0;
  function frame(now) {
    if (!paused) renderer.frame(now);
    if (now - lastHudUpdate > 250) {
      lastHudUpdate = now;
      renderHud(hud, profiler.snapshot());
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderHud(hud, snapshot) {
  const rows = Object.entries(snapshot.passes).map(([name, s]) => {
    const fmt = (v) => v.toFixed(3);
    return `<tr><td>${name}</td><td>${fmt(s.mean)}</td>`
      + `<td>${fmt(s.p95)}</td><td>${fmt(s.p99)}</td><td>${s.n}</td></tr>`;
  }).join('');
  hud.innerHTML = `<table><thead><tr><th>pass</th><th>mean ms</th>`
    + `<th>p95 ms</th><th>p99 ms</th><th>n</th></tr></thead>`
    + `<tbody>${rows}</tbody></table>`;
}

init().catch((err) => {
  document.getElementById('capability').textContent = `Init failed: ${err.message}`;
});
