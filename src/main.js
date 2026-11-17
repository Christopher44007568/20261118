import './style.css';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import { loadBooleanEngine } from './mesh/booleanEngine.js';
import { getScene, OPERATIONS } from './mesh/scenes.js';
import { downloadOBJ } from './mesh/obj.js';
import { Viewer } from './viewer.js';

const OPERATION_COLORS = {
  union: '#62e6c8',
  difference: '#ff8a6a',
  intersection: '#c7a0ff',
};

const state = {
  sceneId: 'intersecting',
  operation: 'union',
  engine: null,
  result: null,
  roundTrip: null,
  runToken: 0,
  firstRun: true,
};

const elements = {
  viewport: document.querySelector('#viewport'),
  engineState: document.querySelector('#engine-state'),
  engineLabel: document.querySelector('#engine-label'),
  sceneCaption: document.querySelector('#scene-caption'),
  statVertices: document.querySelector('#stat-vertices'),
  statTriangles: document.querySelector('#stat-triangles'),
  statVolume: document.querySelector('#stat-volume'),
  statTime: document.querySelector('#stat-time'),
  bboxX: document.querySelector('#bbox-x'),
  bboxY: document.querySelector('#bbox-y'),
  bboxZ: document.querySelector('#bbox-z'),
  validationCard: document.querySelector('#validation-card'),
  checkIcon: document.querySelector('#check-icon'),
  checkTitle: document.querySelector('#check-title'),
  checkDetail: document.querySelector('#check-detail'),
  tagClosed: document.querySelector('#tag-closed'),
  tagNormals: document.querySelector('#tag-normals'),
  tagInternal: document.querySelector('#tag-internal'),
  exportButton: document.querySelector('#export-obj'),
  objReport: document.querySelector('#obj-report'),
  viewportOperation: document.querySelector('#viewport-operation'),
  loading: document.querySelector('#loading-overlay'),
  errorToast: document.querySelector('#error-toast'),
};

const viewer = new Viewer(elements.viewport);
const numberFormatter = new Intl.NumberFormat('zh-CN');

function setButtonState(selector, dataName, activeValue) {
  for (const button of document.querySelectorAll(selector)) {
    const active = button.dataset[dataName] === activeValue;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function operationInfo() {
  return OPERATIONS.find((operation) => operation.id === state.operation);
}

function updateSelectionUI() {
  setButtonState('.scene-button', 'scene', state.sceneId);
  setButtonState('.operation-button', 'operation', state.operation);
  const scene = getScene(state.sceneId);
  const operation = operationInfo();
  elements.sceneCaption.textContent = scene.caption;
  elements.viewportOperation.textContent = `${operation.label} · ${operation.symbol}`;
  document.documentElement.style.setProperty(
    '--accent',
    OPERATION_COLORS[state.operation],
  );
}

function combinedBounds(a, b) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of [a, b]) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], mesh.positions[i + axis]);
        max[axis] = Math.max(max[axis], mesh.positions[i + axis]);
      }
    }
  }
  return { min, max };
}

function formatRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '空';
  return `${min.toFixed(3)}  …  ${max.toFixed(3)}`;
}

function updateStats(result) {
  const topology = result.topology;
  elements.statVertices.textContent = numberFormatter.format(topology.vertexCount);
  elements.statTriangles.textContent = numberFormatter.format(topology.triangleCount);
  elements.statVolume.textContent = topology.empty
    ? '体积 0'
    : `体积 ${result.volume.toFixed(3)}`;
  elements.statTime.textContent = `${result.elapsedMs.toFixed(1)} ms`;
  if (topology.bounds) {
    elements.bboxX.textContent = formatRange(topology.bounds.min[0], topology.bounds.max[0]);
    elements.bboxY.textContent = formatRange(topology.bounds.min[1], topology.bounds.max[1]);
    elements.bboxZ.textContent = formatRange(topology.bounds.min[2], topology.bounds.max[2]);
  } else {
    elements.bboxX.textContent = '空';
    elements.bboxY.textContent = '空';
    elements.bboxZ.textContent = '空';
  }
}

function setTag(element, label, passed) {
  element.textContent = label;
  element.classList.toggle('pass', passed);
  element.classList.toggle('fail', !passed);
}

function updateValidation(result) {
  const topology = result.topology;
  const valid = topology.closed && topology.outward;
  elements.validationCard.classList.toggle('invalid', !valid);
  elements.checkIcon.textContent = valid ? '✓' : '!';
  if (topology.empty) {
    elements.checkTitle.textContent = '空结果 · 拓扑有效';
    elements.checkDetail.textContent = '两壳体无重叠体积，输出为空集';
  } else if (valid) {
    elements.checkTitle.textContent = '闭合外壳 · 验证通过';
    elements.checkDetail.textContent =
      `边界 ${topology.boundaryEdges} · 非流形 ${topology.nonManifoldEdges}` +
      ` · 朝向冲突 ${topology.orientationConflicts}`;
  } else {
    elements.checkTitle.textContent = '拓扑检查未通过';
    elements.checkDetail.textContent =
      `边界 ${topology.boundaryEdges} · 非流形 ${topology.nonManifoldEdges}` +
      ` · 退化 ${topology.degenerateTriangles}`;
  }
  setTag(elements.tagClosed, '闭合拓扑', topology.closed);
  setTag(elements.tagNormals, '法线朝外', topology.outward);
  setTag(elements.tagInternal, '内部面已剔除', valid);
}

function showError(error) {
  elements.errorToast.hidden = false;
  elements.errorToast.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
}

async function runOperation() {
  if (!state.engine) return;
  const token = ++state.runToken;
  elements.exportButton.disabled = true;
  elements.objReport.hidden = true;
  elements.errorToast.hidden = true;
  const scene = getScene(state.sceneId);
  try {
    const result = state.engine.execute(scene.a, scene.b, state.operation);
    if (token !== state.runToken) return;
    state.result = { ...result, scene, operation: state.operation };
    state.roundTrip = null;
    updateStats(result);
    updateValidation(result);
    const bounds = result.topology.bounds ?? combinedBounds(scene.a, scene.b);
    viewer.setScene({
      resultMesh: result.mesh,
      inputA: scene.a,
      inputB: scene.b,
      operation: state.operation,
      bounds,
      accent: OPERATION_COLORS[state.operation],
    });
    elements.exportButton.disabled = false;
  } catch (error) {
    if (token === state.runToken) showError(error);
  } finally {
    if (state.firstRun) {
      state.firstRun = false;
      elements.loading.classList.remove('visible');
    }
  }
}

document.querySelector('#scene-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-scene]');
  if (!button || button.dataset.scene === state.sceneId) return;
  state.sceneId = button.dataset.scene;
  updateSelectionUI();
  runOperation();
});

document.querySelector('#operation-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-operation]');
  if (!button || button.dataset.operation === state.operation) return;
  state.operation = button.dataset.operation;
  updateSelectionUI();
  runOperation();
});

document.querySelector('#show-inputs').addEventListener('change', (event) => {
  viewer.setInputVisibility(event.target.checked);
});

document.querySelector('#reset-view').addEventListener('click', () => {
  viewer.resetView();
});

elements.exportButton.addEventListener('click', () => {
  if (!state.result || !state.engine) return;
  try {
    const name = `mesh-${state.sceneId}-${state.operation}`;
    const report = state.engine.verifyOBJRoundTrip(state.result.mesh, name);
    state.roundTrip = report;
    const topology = report.reloadedTopology;
    elements.objReport.hidden = false;
    elements.objReport.textContent = report.passed
      ? `OBJ 往返通过 · ${topology.vertexCount} 顶点 / ` +
        `${topology.triangleCount} 三角形 · 边界 ${topology.boundaryEdges}`
      : `OBJ 往返失败 · 边界 ${topology.boundaryEdges} · ` +
        `非流形 ${topology.nonManifoldEdges}`;
    downloadOBJ(report.objText, `${name}.obj`);
  } catch (error) {
    showError(error);
  }
});

window.meshBooleanApp = {
  getState: () => state,
  run: runOperation,
  loadEngine: () => loadBooleanEngine({ wasmUrl: manifoldWasmUrl }),
};

updateSelectionUI();

loadBooleanEngine({ wasmUrl: manifoldWasmUrl })
  .then((engine) => {
    state.engine = engine;
    elements.engineState.classList.add('ready');
    elements.engineLabel.textContent = 'WASM 内核已就绪';
    return runOperation();
  })
  .catch((error) => {
    elements.engineLabel.textContent = 'WASM 加载失败';
    elements.loading.classList.remove('visible');
    showError(error);
  });
