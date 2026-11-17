// Orchestrates encode -> decode (CPU / WebGL2 / WebGPU) -> metrics -> UI.

import { FORMATS, encodeImage, compressedByteSize, blockDimensions } from './codec.js';
import { globalMetrics, blockMetrics } from './metrics.js';
import { makePattern, loadImageFile } from './patterns.js';
import { decodeCPU, capabilities as cpuCapabilities } from './backends/cpu.js';
import { decodeWebGL2, capabilities as gl2Capabilities } from './backends/webgl2.js';
import { decodeWebGPU, capabilities as gpuCapabilities } from './backends/webgpu.js';
import {
  drawImage, drawBlockColors, drawHeatMap, drawDifference, attachImageSize,
} from './render.js';

const state = {
  image: null,
  format: 'BC1',
  encoded: null,
  runs: [],
  viewBackend: 'CPU',
  lastResults: null,
};

const $ = (id) => document.getElementById(id);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function showStatus(message, isError = false) {
  const element = $('status');
  element.textContent = message;
  element.className = isError ? 'status error' : 'status';
}

async function detectBackends() {
  const backends = {
    CPU: cpuCapabilities(),
    WebGL2: gl2Capabilities(),
  };
  backends.WebGPU = await gpuCapabilities();

  const panel = $('backend-status');
  panel.innerHTML = '';
  for (const [name, info] of Object.entries(backends)) {
    const row = document.createElement('div');
    row.className = 'backend-row';
    const native = info.available ? (info.nativeBC ? '原生 BC 硬件解码' : '仅 CPU 回退') : '不可用';
    row.innerHTML = `<span class="backend-name">${name}</span>
      <span class="backend-mode ${info.nativeBC ? 'good' : info.available ? 'warn' : 'bad'}">${native}</span>`;
    panel.appendChild(row);
  }
  return backends;
}

async function runDecoder(name, backends) {
  const { width, height } = state.image;
  const encoded = state.encoded;
  try {
    if (name === 'CPU') {
      return decodeCPU(encoded, width, height, state.format);
    }
    if (name === 'WebGL2') {
      if (!backends.WebGL2.available) return { skipped: true, reason: 'WebGL2 不可用' };
      return decodeWebGL2(encoded, width, height, state.format);
    }
    if (!(await backends.WebGPU.available)) {
      return { skipped: true, reason: 'WebGPU 不可用' };
    }
    if (!backends.WebGPU.nativeBC) {
      return { skipped: true, reason: '缺少 texture-compression-bc 特性' };
    }
    return await decodeWebGPU(encoded, width, height, state.format);
  } catch (error) {
    return { error: error.message, backend: name };
  }
}

function estimateMemory(result, width, height) {
  // The reported "VRAM" is the storage the driver needs for the compressed
  // texture plus the RGBA render/readback targets used during decoding.
  const rgbaSize = width * height * 4;
  const rowPadded = Math.ceil((width * 4) / 256) * 256;
  const staging = result.backend === 'WebGPU' ? rowPadded * height : rgbaSize;
  return {
    compressed: result.compressedBytes,
    renderTarget: rgbaSize,
    staging,
    total: result.compressedBytes + rgbaSize + staging,
  };
}

function compareWithCpu(result, cpuResult) {
  if (result.backend === 'CPU' || result.skipped || result.error) return null;
  let mismatch = 0;
  let maxDelta = 0;
  for (let i = 0; i < cpuResult.data.length; i++) {
    const delta = Math.abs(result.data[i] - cpuResult.data[i]);
    if (delta > 2) mismatch++;
    maxDelta = Math.max(maxDelta, delta);
  }
  return { mismatch, maxDelta, total: cpuResult.data.length };
}

function renderResults(results) {
  state.lastResults = results;
  const cpuResult = results.find((r) => r.backend === 'CPU');
  let selected = results.find((r) => r.backend === state.viewBackend && !r.skipped && !r.error);
  if (!selected) {
    selected = cpuResult;
    state.viewBackend = 'CPU';
    const fallbackRadio = document.querySelector('input[name="view-backend"][value="CPU"]');
    if (fallbackRadio) fallbackRadio.checked = true;
  }

  const image = state.image;
  drawImage($('original-canvas'), image);
  drawImage($('decoded-canvas'), selected);
  drawDifference($('diff-canvas'), image, selected);

  const blockInfo = attachImageSize(
    blockMetrics(image.data, selected.data, image.width, image.height, state.format),
    image.width, image.height,
  );
  drawBlockColors($('blocks-canvas'), blockInfo);
  drawHeatMap($('heatmap-canvas'), blockInfo);

  const metrics = globalMetrics(image.data, selected.data, image.width, image.height);
  $('metrics').innerHTML = `
    <tr><td>RMSE (RGB 均值)</td><td>${metrics.rmse.rgb.toFixed(3)}</td></tr>
    <tr><td>RMSE R / G / B</td><td>${metrics.rmse.r.toFixed(2)} / ${metrics.rmse.g.toFixed(2)} / ${metrics.rmse.b.toFixed(2)}</td></tr>
    <tr><td>RMSE Alpha</td><td>${metrics.rmse.a.toFixed(3)}</td></tr>
    <tr><td>PSNR</td><td>${Number.isFinite(metrics.psnr) ? `${metrics.psnr.toFixed(2)} dB` : '∞ (无损)'}</td></tr>
    <tr><td>单像素最大误差</td><td>${metrics.maxError}</td></tr>
    <tr><td>最大块平均误差</td><td>${blockInfo.maxBlockError.toFixed(2)}</td></tr>`;

  const dims = blockDimensions(image.width, image.height);
  $('size-info').textContent =
    `${image.width}×${image.height} 像素 → ${dims.blocksX}×${dims.blocksY} 块` +
    (blockInfo.ragged ? `（填充至 ${dims.paddedWidth}×${dims.paddedHeight}，边缘块钳制处理）` : '');

  renderRunTable(results, cpuResult);
}

function renderRunTable(results, cpuResult) {
  const table = $('runs-body');
  table.innerHTML = '';
  for (const result of results) {
    const row = document.createElement('tr');
    if (result.skipped) {
      row.innerHTML = `<td>${result.reason}</td><td colspan="6">未执行</td>`;
      table.appendChild(row);
      continue;
    }
    if (result.error) {
      row.innerHTML = `<td>${result.backend}</td><td colspan="6" class="bad">${result.error}</td>`;
      table.appendChild(row);
      continue;
    }
    const memory = estimateMemory(result, result.width, result.height);
    const cross = compareWithCpu(result, cpuResult);
    const crossText = cross
      ? cross.mismatch === 0
        ? '<span class="good">与 CPU 一致</span>'
        : `<span class="warn">${cross.mismatch} 分量差 &gt;2（最大 ${cross.maxDelta}）</span>`
      : '参考实现';
    row.innerHTML = `
      <td>${result.backend}</td>
      <td>${result.mode}</td>
      <td>${result.elapsedMs.toFixed(3)} ms${result.gpuElapsedMs != null ? `<br><small>GPU 计时 ${result.gpuElapsedMs.toFixed(3)} ms</small>` : ''}</td>
      <td>${formatBytes(memory.compressed)}<br><small>总占用 ${formatBytes(memory.total)}</small></td>
      <td>${formatBytes(memory.renderTarget)}<br><small>暂存 ${formatBytes(memory.staging)}</small></td>
      <td>${crossText}</td>`;
    table.appendChild(row);
  }
}

async function runAll() {
  if (!state.image) {
    showStatus('请先生成或上传一张图案', true);
    return;
  }
  showStatus('编码与解码中…');
  const backends = await detectBackends();
  state.format = $('format-select').value;

  const encodeStart = performance.now();
  state.encoded = encodeImage(state.image.data, state.image.width, state.image.height, state.format);
  const encodeMs = performance.now() - encodeStart;
  $('encode-info').textContent =
    `${FORMATS[state.format].label}：${formatBytes(compressedByteSize(state.image.width, state.image.height, state.format))}` +
    `（原始 RGBA ${formatBytes(state.image.data.byteLength)}，编码耗时 ${encodeMs.toFixed(2)} ms）`;

  const results = [];
  for (const name of ['CPU', 'WebGL2', 'WebGPU']) {
    results.push(await runDecoder(name, backends));
  }
  state.runs.push({
    pattern: state.image.label,
    width: state.image.width,
    height: state.image.height,
    format: state.format,
    encodeMs,
    results: results.map((r) => (r.error || r.skipped
      ? { backend: r.backend || r.reason, status: r.error || r.reason }
      : {
        backend: r.backend,
        mode: r.mode,
        elapsedMs: Number(r.elapsedMs.toFixed(3)),
        compressedBytes: r.compressedBytes,
        totalMemory: estimateMemory(r, r.width, r.height).total,
      })),
  });
  renderResults(results);
  showStatus(`完成：${state.image.label} / ${state.format}`);
}

function loadPattern(name) {
  const width = Number($('width-input').value) || 30;
  const height = Number($('height-input').value) || 22;
  state.image = makePattern(name, width, height);
  showStatus(`已生成 ${state.image.label}（${width}×${height}）`);
}

function bindUi() {
  $('pattern-gradient').addEventListener('click', () => loadPattern('gradient'));
  $('pattern-hard-edge').addEventListener('click', () => loadPattern('hard-edge'));
  $('pattern-noise').addEventListener('click', () => loadPattern('noise'));
  $('run-button').addEventListener('click', runAll);
  $('export-button').addEventListener('click', exportReport);
  $('file-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      state.image = await loadImageFile(file);
      $('width-input').value = state.image.width;
      $('height-input').value = state.image.height;
      showStatus(`已载入 ${state.image.label}`);
    } catch (error) {
      showStatus(error.message, true);
    }
  });
  for (const radio of document.querySelectorAll('input[name="view-backend"]')) {
    radio.addEventListener('change', (event) => {
      state.viewBackend = event.target.value;
      if (state.lastResults) renderResults(state.lastResults);
    });
  }
}

function exportReport() {
  if (!state.runs.length) {
    showStatus('还没有可导出的运行记录', true);
    return;
  }
  const blob = new Blob([JSON.stringify({
    generatedAt: new Date().toISOString(),
    runs: state.runs,
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'bc-compression-report.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

async function boot() {
  bindUi();
  await detectBackends();
  loadPattern('gradient');
}

boot();
