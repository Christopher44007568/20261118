import { SimulatedShaderCompiler } from '../src/shaderCompiler.js';
import { PipelineCache } from '../src/pipelineCache.js';
import { WarmupController } from '../src/warmupController.js';
import { variantKey, describeKey } from '../src/variantKey.js';
import {
  MATERIALS,
  CAMERAS,
  DEFAULT_RENDER_SETTINGS,
  visibleMaterials,
  variantFor,
} from '../src/scene.js';
import {
  el,
  renderMetrics,
  renderWarmupProgress,
  renderCacheList,
  renderEventLog,
  renderMaterialGrid,
} from './dashboard.js';

const compiler = new SimulatedShaderCompiler({
  baseLatencyMs: 120,
  jitterMs: 90,
  maxConcurrent: 2,
});
let cache = new PipelineCache(compiler, { capacity: 12 });
let controller = new WarmupController(cache);
let currentCamera = CAMERAS[0].id;
let renderSettings = { ...DEFAULT_RENDER_SETTINGS };
let latestReport = null;

const renderSettingsNow = () => renderSettings;
const variantResolver = (material) => variantFor(material, renderSettingsNow());

function renderCameraButtons() {
  el('cameraButtons').innerHTML = CAMERAS
    .map((camera) => `
      <button class="btn ${camera.id === currentCamera ? 'active' : ''}" data-camera="${camera.id}">
        ${camera.label}
      </button>`)
    .join('');
  el('cameraLabel').textContent = CAMERAS.find((c) => c.id === currentCamera).label;
  el('cameraButtons').querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => switchCamera(button.dataset.camera));
  });
}

function tileStatus(material) {
  const key = variantKey(variantFor(material, renderSettings));
  const entry = cache.entries.get(key);
  if (!entry) return { cls: 'compiling', text: '排队/编译中' };
  if (entry.status === 'compiling') return { cls: 'compiling', text: '编译中' };
  if (entry.status === 'error') return { cls: 'fallback', text: '使用回退管线' };
  return { cls: 'ready', text: '缓存就绪' };
}

function renderViewport() {
  const materials = visibleMaterials(currentCamera);
  el('viewport').innerHTML = materials
    .map((material) => {
      const variant = variantFor(material, renderSettings);
      const status = tileStatus(material);
      return `
        <div class="mat-tile pending" data-material="${material.id}">
          <span class="state ${status.cls}">${status.text}</span>
          <h4>${material.label}</h4>
          <div class="key">${describeKey(variantKey(variant))}</div>
        </div>`;
    })
    .join('');
  renderWarmupProgress(0, materials.length);
}

function refreshTiles(report) {
  const readyIds = new Set(report.perMaterial.map((r) => r.materialId));
  for (const tile of el('viewport').querySelectorAll('.mat-tile')) {
    const material = MATERIALS.find((m) => m.id === tile.dataset.material);
    const status = tileStatus(material);
    const badge = tile.querySelector('.state');
    badge.className = `state ${status.cls}`;
    badge.textContent = status.text;
    if (readyIds.has(tile.dataset.material)) {
      tile.classList.remove('pending');
      tile.classList.add('flash');
      setTimeout(() => tile.classList.remove('flash'), 350);
    }
  }
  renderWarmupProgress(report.perMaterial.length, report.perMaterial.length);
}

let pollTimer = null;
function startLivePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    renderMetrics(cache, latestReport);
    renderCacheList(cache);
    // 编译队列清空后停止轮询，避免无意义刷新
    if (cache.queueDepth === 0) {
      clearInterval(pollTimer);
      pollTimer = null;
      renderAll();
    }
  }, 120);
}

function renderAll() {
  renderMetrics(cache, latestReport);
  renderCacheList(cache);
  renderEventLog(controller);
  renderMaterialGrid(MATERIALS, currentCamera, cache, variantResolver);
  renderCameraButtons();
}

async function switchCamera(cameraId) {
  if (cameraId === currentCamera && latestReport) return;
  currentCamera = cameraId;
  renderCameraButtons();
  renderViewport();
  startLivePolling();
  latestReport = await controller.enterCamera(cameraId, renderSettings);
  refreshTiles(latestReport);
  renderAll();
}

function bindControls() {
  el('lightingSelect').addEventListener('change', async (event) => {
    renderSettings = { ...renderSettings, lighting: event.target.value };
    latestReport = null;
    renderViewport();
    startLivePolling();
    latestReport = await controller.applyRenderSettings(currentCamera, renderSettings);
    refreshTiles(latestReport);
    renderAll();
  });
  el('shadowSelect').addEventListener('change', async (event) => {
    renderSettings = { ...renderSettings, shadow: event.target.value };
    latestReport = null;
    renderViewport();
    startLivePolling();
    latestReport = await controller.applyRenderSettings(currentCamera, renderSettings);
    refreshTiles(latestReport);
    renderAll();
  });

  el('btnFailVariant').addEventListener('click', () => {
    const signage = MATERIALS.find((m) => m.id === 'signage');
    const variant = variantFor(signage, renderSettings);
    compiler.markFailing(variant);
    controller.log(`已注入失败变体: ${variantKey(variant)}`, { warn: true });
    renderAll();
  });
  el('btnClearFail').addEventListener('click', () => {
    compiler.clearFailing();
    controller.log('已清除全部失败标记（注意：已缓存的错误条目需重置缓存才会重编）');
    renderAll();
  });
  el('capacityInput').addEventListener('change', (event) => {
    const capacity = Math.max(2, Math.min(40, Number(event.target.value) || 12));
    event.target.value = capacity;
    cache.capacity = capacity;
    while (cache.size > capacity) cache.evictIfNeeded();
    controller.log(`缓存容量调整为 ${capacity}，立即淘汰 ${cache.stats.evictions} 次`);
    renderAll();
  });
  el('btnReset').addEventListener('click', () => {
    cache = new PipelineCache(compiler, { capacity: Number(el('capacityInput').value) || 12 });
    controller = new WarmupController(cache);
    latestReport = null;
    renderViewport();
    renderAll();
  });
}

bindControls();
switchCamera(CAMERAS[0].id);
