import "@fontsource-variable/noto-sans-sc/wght.css";
import { FIELDS } from "./fields.js";
import { sampleGrid } from "./grid.js";
import { extractSurfaceNets } from "./surface-nets.js";
import { extractMarchingCubes } from "./marching-cubes.js";
import { validateMesh } from "./validate.js";
import { meshToJson, meshToObj } from "./exporters.js";
import { createIsoScene } from "./scene.js";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#scene-canvas");
const scene = createIsoScene(canvas);

const state = {
  field: FIELDS[0],
  iso: FIELDS[0].threshold.value,
  smoothing: FIELDS[0].smoothing,
  resolution: 48,
  normals: false,
  edges: true,
};

let latest = null;
let rebuildFrame = 0;
let lastIso = state.iso;

const fieldList = $("#field-list");
const isoSlider = $("#iso-slider");
const smoothingSlider = $("#smoothing-slider");
const normalToggle = $("#normal-toggle");
const wireToggle = $("#wire-toggle");

renderFieldButtons();
bindControls();
applyField(FIELDS[0], { rebuild: false });
setDisplayState();
rebuild("initial");

function renderFieldButtons() {
  for (const field of FIELDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "field-button";
    button.dataset.field = field.id;
    button.title = field.description;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `
      <span class="field-swatch" style="background:${field.accent}"></span>
      <b>${field.label}</b>
      <small>${field.english.toUpperCase()}</small>
    `;
    button.addEventListener("click", () => {
      if (state.field.id === field.id) return;
      applyField(field, { rebuild: false });
      scheduleRebuild("field");
    });
    fieldList.append(button);
  }
}

function bindControls() {
  isoSlider.addEventListener("input", () => {
    state.iso = Number(isoSlider.value);
    $("#iso-value").textContent = signed(state.iso, 3);
    updateRangeFill(isoSlider);
    scheduleRebuild("threshold");
  });

  smoothingSlider.addEventListener("input", () => {
    state.smoothing = Number(smoothingSlider.value);
    $("#smoothing-value").textContent = state.smoothing.toFixed(2);
    updateRangeFill(smoothingSlider);
    updateSmoothingNote();
    scheduleRebuild("smoothing");
  });

  for (const button of document.querySelectorAll("[data-resolution]")) {
    button.addEventListener("click", () => {
      state.resolution = Number(button.dataset.resolution);
      for (const candidate of document.querySelectorAll("[data-resolution]")) {
        candidate.classList.toggle("is-active", candidate === button);
      }
      $("#header-resolution").textContent = `${state.resolution}³`;
      scheduleRebuild("resolution");
    });
  }

  normalToggle.addEventListener("change", () => {
    state.normals = normalToggle.checked;
    scene.setNormalVisible(state.normals);
  });

  wireToggle.addEventListener("change", () => {
    state.edges = wireToggle.checked;
    scene.setEdgeVisible(state.edges);
  });

  $("#reset-view").addEventListener("click", () => scene.resetView());

  $("#export-obj").addEventListener("click", () => {
    if (!latest) return;
    const name = `${state.field.id}-iso-${state.iso.toFixed(3)}.obj`;
    downloadText(name, meshToObj(latest.surfaceNets, state.field.label));
    $("#event-log").textContent = `已导出 ${name} · ${latest.surfaceNets.faceCount} quads + ${latest.surfaceNets.vertexCount} vn`;
  });

  $("#export-json").addEventListener("click", () => {
    if (!latest) return;
    const name = `${state.field.id}-iso-${state.iso.toFixed(3)}.json`;
    downloadText(name, meshToJson(latest.surfaceNets, latest.snValidation));
    $("#event-log").textContent = `已导出 ${name} · 含网格、法线与审计结果`;
  });
}

function applyField(field, options = {}) {
  state.field = field;
  state.iso = field.threshold.value;
  state.smoothing = field.smoothing;

  for (const button of document.querySelectorAll("[data-field]")) {
    const active = button.dataset.field === field.id;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  $("#header-field").textContent = field.english.toUpperCase();
  $("#field-equation").textContent = field.equation;
  $("#iso-min").textContent = signed(field.threshold.min, 3);
  $("#iso-max").textContent = signed(field.threshold.max, 3);
  $("#iso-zero").textContent = "0";

  isoSlider.min = String(field.threshold.min);
  isoSlider.max = String(field.threshold.max);
  isoSlider.step = String(field.threshold.step);
  isoSlider.value = String(state.iso);
  $("#iso-value").textContent = signed(state.iso, 3);
  updateRangeFill(isoSlider);

  smoothingSlider.value = String(state.smoothing);
  $("#smoothing-value").textContent = state.smoothing.toFixed(2);
  updateRangeFill(smoothingSlider);
  updateSmoothingNote();

  if (options.rebuild !== false) rebuild("field");
}

function updateSmoothingNote() {
  const note = $("#smoothing-note");
  note.classList.toggle("is-sharp", state.field.id === "sharp");
  if (state.field.id === "sharp") {
    note.textContent = `锐边保护 · 自动初始化为 λ = ${state.field.smoothing.toFixed(2)}，提高平滑会圆化棱角。`;
  } else {
    note.textContent = `高 λ 让对偶顶点更贴近邻域均值；尖锐场会自动降低。当前 λ = ${state.smoothing.toFixed(2)}。`;
  }
}

function scheduleRebuild(reason) {
  if (rebuildFrame) cancelAnimationFrame(rebuildFrame);
  rebuildFrame = requestAnimationFrame(() => {
    rebuildFrame = 0;
    rebuild(reason);
  });
}

function rebuild(reason) {
  const started = performance.now();
  const grid = sampleGrid(state.field, {
    resolution: state.resolution,
    iso: state.iso,
  });
  const surfaceNets = extractSurfaceNets(grid, {
    smoothing: state.smoothing,
  });
  const marchingCubes = extractMarchingCubes(grid);
  const snValidation = validateMesh(surfaceNets);
  const mcValidation = validateMesh(marchingCubes);
  const totalTime = performance.now() - started;

  latest = {
    grid,
    surfaceNets,
    marchingCubes,
    snValidation,
    mcValidation,
    totalTime,
    field: state.field.id,
    iso: state.iso,
  };

  scene.setMeshes(surfaceNets, marchingCubes);
  scene.setNormalVisible(state.normals);
  scene.setEdgeVisible(state.edges);
  updateMetrics(totalTime);
  updateAudit(snValidation);
  updateEventLog(reason);
  $("#build-status").textContent = `THRESHOLD ${signed(state.iso, 3)}`;
  document.body.dataset.ready = "true";
  window.__surfaceNetsLab = {
    getState: () => ({
      field: state.field.id,
      iso: state.iso,
      smoothing: state.smoothing,
      resolution: state.resolution,
    }),
    surfaceNets,
    marchingCubes,
    snValidation,
    mcValidation,
    totalTime,
  };
  lastIso = state.iso;
}

function updateMetrics(time) {
  const { surfaceNets: sn, marchingCubes: mc } = latest;
  $("#sn-vertices").textContent = count(sn.vertexCount);
  $("#sn-faces").textContent = count(sn.faceCount);
  $("#mc-faces").textContent = count(mc.faceCount);
  const reduction = mc.faceCount > 0
    ? (1 - sn.faceCount / mc.faceCount) * 100
    : 0;
  $("#face-reduction").textContent = `${reduction.toFixed(1)}%`;
  $("#triangle-fairness").textContent =
    `三角化 ${count(sn.triangleCount)} vs ${count(mc.faceCount)}`;

  $("#active-voxels").textContent = count(sn.activeCells);
  $("#build-time").textContent = `${Math.round(time)} ms`;

  $("#bar-sn-value").textContent = count(sn.faceCount);
  $("#bar-mc-value").textContent = count(mc.faceCount);
  $("#bar-sn").style.width = `${(sn.faceCount / mc.faceCount) * 100}%`;
  $("#bar-mc").style.width = "100%";
  $("#comparison-copy").textContent =
    `四边形面数 ${count(sn.faceCount)}，三角基准 ${count(mc.faceCount)}，`
    + `减少 ${reduction.toFixed(1)}%；按等面积三角化比较为 `
    + `${count(sn.triangleCount)} vs ${count(mc.faceCount)}。`;
}

function updateAudit(validation) {
  const stateNode = $("#audit-state");
  const icon = stateNode.querySelector(".audit-icon");
  stateNode.classList.toggle("is-pass", validation.passed);
  stateNode.classList.toggle("is-fail", !validation.passed);
  icon.textContent = validation.passed ? "✓" : "!";
  stateNode.querySelector("b").textContent = validation.passed ? "PASS" : "CHECK";
  $("#audit-summary").textContent = validation.passed
    ? "封闭、连续、无重复面"
    : "检测到需要检查的拓扑项";

  setAuditValue("#audit-duplicates", validation.duplicateFaces + validation.duplicateGeometricFaces);
  setAuditValue("#audit-boundary", validation.boundaryEdges);
  setAuditValue("#audit-nonmanifold", validation.nonManifoldEdges);
  setAuditValue("#audit-components", validation.connectedComponents, false);
  setAuditValue("#audit-winding", validation.inconsistentEdges);
  setAuditValue("#audit-normals", validation.invalidNormals);

  const watertight =
    validation.isClosed &&
    validation.isManifold &&
    validation.noDuplicateFaces;
  $("#audit-watertight").textContent = watertight ? "TRUE" : "FALSE";
  $("#audit-watertight").style.color = watertight ? "" : "var(--danger)";
  $("#surface-state").textContent = validation.continuous
    ? "CONNECTED"
    : validation.connectedComponents > 1
      ? `${validation.connectedComponents} COMPONENTS`
      : "CHECK";
  $("#surface-state").style.color = validation.continuous ? "" : "var(--danger)";
}

function setAuditValue(selector, value, errorWhenNonzero = true) {
  const node = $(selector);
  node.textContent = String(value);
  node.classList.toggle("has-error", errorWhenNonzero && value !== 0);
}

function updateEventLog(reason) {
  const sn = latest.surfaceNets;
  if (reason === "initial") {
    $("#event-log").textContent =
      `iso ${signed(state.iso, 3)} → SN ${count(sn.faceCount)} quads / MC ${count(latest.marchingCubes.faceCount)} tris`;
    return;
  }
  if (reason === "threshold") {
    $("#event-log").textContent =
      `iso ${signed(lastIso, 3)} → ${signed(state.iso, 3)} · `
      + `V ${count(sn.vertexCount)} · F ${count(sn.faceCount)} · 法线已重建`;
    return;
  }
  if (reason === "field") {
    $("#event-log").textContent =
      `${state.field.english} · λ ${state.smoothing.toFixed(2)} · `
      + `${count(sn.activeCells)} active voxels`;
    return;
  }
  $("#event-log").textContent =
    `${reason} updated · ${count(sn.faceCount)} quads · ${Math.round(latest.totalTime)} ms`;
}

function setDisplayState() {
  normalToggle.checked = state.normals;
  wireToggle.checked = state.edges;
  $("#header-resolution").textContent = `${state.resolution}³`;
}

function updateRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  input.style.setProperty(
    "--range-progress",
    `${max === min ? 0 : ((value - min) / (max - min)) * 100}%`,
  );
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function count(value) {
  return Number(value).toLocaleString("en-US");
}

function signed(value, digits) {
  const threshold = 0.5 * 10 ** -digits;
  const normalized = Math.abs(value) < threshold ? 0 : value;
  return `${normalized > 0 ? "+" : normalized < 0 ? "−" : ""}${Math.abs(normalized).toFixed(digits)}`;
}
