import { loadBaker } from "./baker.js";
import { SCENE, buildScenarios } from "./meshes.js";
import { Renderer } from "./renderer.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  active: "hard",
  projection: "cage",
  resolution: 512,
  cageOffset: 0.2,
  rayDistance: 0.4,
  weightScale: 8,
  maxHits: 8,
  normalMix: 0.55,
  previewMode: "normal",
  showLow: true,
  showHigh: true,
  showWire: true,
  showBake: true,
  scenarios: null,
  results: { hard: null, rounded: null },
};

const PROJECTION_LABELS = { cage: "包围笼", nearest: "最近表面" };
const SCENARIO_LABELS = { hard: "硬边箱体", rounded: "圆角箱体" };
const renderer = new Renderer($("#viewport"));
const previewCanvas = $("#texturePreview");
const previewContext = previewCanvas.getContext("2d");
let baker = null;
let bakeChain = Promise.resolve();
let autoTimer = 0;
let renderQueued = false;

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const result = state.results[state.active];
    renderer.draw({
      showLow: state.showLow,
      showHigh: state.showHigh,
      showHighFill: true,
      showWire: state.showWire,
      showBake: state.showBake && Boolean(result),
      normalMix: state.normalMix,
    });
  });
}

function setStatus(text, mode = "ready", duration = null) {
  $("#statusText").textContent = text;
  $("#statusDot").className = `status-dot ${mode}`;
  $("#statusTime").textContent = duration == null ? "—" : `${duration.toFixed(1)} ms`;
}

function updateSliderDisplays() {
  $("#rayDistanceValue").value = state.rayDistance.toFixed(3);
  $("#cageOffsetValue").value = state.cageOffset.toFixed(3);
  $("#weightScaleValue").value = state.weightScale.toFixed(1);
  $("#maxHitsValue").value = String(state.maxHits);
}

function setActiveSegment(container, value) {
  $$(`#${container} button`).forEach((button) => {
    button.classList.toggle("active", button.dataset.value === value);
  });
}

function updateSceneBadge() {
  $("#sceneBadgeLabel").textContent =
    `${SCENARIO_LABELS[state.active]} / ${PROJECTION_LABELS[state.projection]} / ${state.resolution}²`;
}

function updateProjectionHelp() {
  $("#projectionHelp").textContent = state.projection === "cage"
    ? "笼顶点沿低模平滑拐角法线外扩，射线方向取像素点到笼的插值方向。"
    : "每个 UV 像素先查询高模 BVH 最近点，再沿该方向投射并累计多个命中。";
}

function markDirty() {
  updateSceneBadge();
  updateProjectionHelp();
  setStatus(`${SCENARIO_LABELS[state.active]} 参数已改变，准备重新烘焙…`, "busy");
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => queueBake([state.active]), 220);
}

function choseScenario(id) {
  if (!state.scenarios || id === state.active) return;
  state.active = id;
  $$("#scenarioTabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.scenario === id);
  });
  const scene = state.scenarios[id];
  renderer.setHighMesh(scene.high);
  const result = state.results[id];
  if (result) renderer.setBake(result.texture, result.width, result.height);
  else renderer.clearBake();
  updateSceneBadge();
  updateMetrics();
  drawPreview();
  scheduleRender();
  if (!result) queueBake([id], 0);
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function updateMetrics() {
  const result = state.results[state.active];
  const valid = Boolean(result);
  $("#metricCoverage").textContent = valid ? `${(result.stats.coverage * 100).toFixed(1)}%` : "—";
  $("#metricDistance").textContent = valid ? result.stats.avgDistance.toFixed(3) : "—";
  $("#metricZero").textContent = valid ? formatCount(result.stats.zeroPixels) : "—";
  $("#metricHits").textContent = valid
    ? `${result.stats.avgHitsPerPixel.toFixed(2)} / ${result.stats.maxHits}`
    : "—";
  $("#metricTriTests").textContent = valid ? formatCount(result.stats.triangleTests) : "—";
  $("#metricTime").textContent = valid ? `${result.durationMs.toFixed(1)} ms` : "—";
  $("#rayNotice").hidden = !valid || result.stats.coverage >= 0.55;
  if (valid && result.stats.coverage < 0.55) {
    $("#rayNotice").textContent =
      `覆盖率仅 ${(result.stats.coverage * 100).toFixed(1)}%。检查射线距离是否小于高模间隙（约 0.17），或笼偏移是否导致方向偏离。`;
  }
  updateCompare();
}

function updateCompare() {
  const rows = [];
  for (const id of ["hard", "rounded"]) {
    const result = state.results[id];
    if (!result) {
      rows.push(`<tr><td>${SCENARIO_LABELS[id].slice(0, 2)}</td><td>—</td><td>—</td><td>—</td></tr>`);
    } else {
      rows.push(
        `<tr><td>${id === "hard" ? "硬边" : "圆角"}</td>` +
        `<td>${(result.stats.coverage * 100).toFixed(1)}%</td>` +
        `<td>${result.stats.avgDistance.toFixed(3)}</td>` +
        `<td>${result.stats.maxHits}</td></tr>`,
      );
    }
  }
  $("#compareBody").innerHTML = rows.join("");
}

function drawAtlasGuides(width, height) {
  const cellW = 1 / SCENE.atlasColumns;
  const cellH = 1 / SCENE.atlasRows;
  previewContext.save();
  previewContext.strokeStyle = "rgba(230, 245, 255, 0.13)";
  previewContext.lineWidth = Math.max(1, width / 512);
  for (let row = 0; row < SCENE.atlasRows; row++) {
    for (let column = 0; column < SCENE.atlasColumns; column++) {
      const x = (column * cellW + SCENE.gutter) * width;
      const y = (1 - (row + 1) * cellH + SCENE.gutter) * height;
      const w = (cellW - SCENE.gutter * 2) * width;
      const h = (cellH - SCENE.gutter * 2) * height;
      previewContext.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }
  previewContext.restore();
}

function drawPreview() {
  const result = state.results[state.active];
  if (!result) {
    previewCanvas.width = 512;
    previewCanvas.height = 512;
    previewContext.fillStyle = "#0c1119";
    previewContext.fillRect(0, 0, 512, 512);
    previewContext.fillStyle = "#637287";
    previewContext.font = "12px monospace";
    previewContext.textAlign = "center";
    previewContext.fillText("等待烘焙…", 256, 256);
    return;
  }
  const width = result.width;
  const height = result.height;
  previewCanvas.width = width;
  previewCanvas.height = height;
  const image = previewContext.createImageData(width, height);
  const data = image.data;
  const texture = result.texture;
  for (let y = 0; y < height; y++) {
    const sourceRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const source = (sourceRow * width + x) * 4;
      const target = (y * width + x) * 4;
      const hit = texture[source + 3] > 0;
      if (state.previewMode === "mask") {
        const check = ((x >> 3) + (y >> 3)) & 1 ? 17 : 23;
        data[target] = hit ? 72 : check + 15;
        data[target + 1] = hit ? 218 : check;
        data[target + 2] = hit ? 172 : check + 12;
      } else {
        data[target] = Math.round(texture[source] * 255);
        data[target + 1] = Math.round(texture[source + 1] * 255);
        data[target + 2] = Math.round(texture[source + 2] * 255);
      }
      data[target + 3] = 255;
    }
  }
  previewContext.putImageData(image, 0, 0);
  drawAtlasGuides(width, height);
  $("#previewCaption").textContent = state.previewMode === "normal"
    ? "切线空间法线。紫蓝色为中性值；白色细线标出 UV 岛边界，便于检查接缝。"
    : "青绿色为有效命中，暗色为零命中；UV 岛之间的 gutter 保持中性。";
}

function currentBakeOptions() {
  return {
    highMesh: state.scenarios[state.active].high,
    lowMesh: state.scenarios.low,
    resolution: state.resolution,
    projection: state.projection,
    cageOffset: state.cageOffset,
    rayDistance: state.rayDistance,
    weightScale: state.weightScale,
    maxHits: state.maxHits,
  };
}

async function runBake(ids) {
  if (!baker || !state.scenarios) return;
  $("#bakeCurrent").disabled = true;
  $("#bakeBoth").disabled = true;
  try {
    for (const id of ids) {
      setStatus(`WASM BVH 烘焙中 · ${SCENARIO_LABELS[id]}…`, "busy");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const scene = state.scenarios[id];
      const result = baker.bake({
        ...currentBakeOptions(),
        highMesh: scene.high,
      });
      state.results[id] = result;
      if (id === state.active) {
        renderer.setBake(result.texture, result.width, result.height);
        updateMetrics();
        drawPreview();
        scheduleRender();
      }
    }
    const activeResult = state.results[state.active];
    const label = ids.length > 1 ? "双场景烘焙完成" : `${SCENARIO_LABELS[ids[0]]}烘焙完成`;
    setStatus(label, "ready", activeResult?.durationMs ?? null);
    updateCompare();
  } catch (error) {
    console.error(error);
    setStatus(`烘焙失败：${error.message}`, "busy");
  } finally {
    $("#bakeCurrent").disabled = false;
    $("#bakeBoth").disabled = false;
  }
}

function queueBake(ids, delay = 0) {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    bakeChain = bakeChain
      .then(() => runBake(ids))
      .catch((error) => console.error(error));
  }, delay);
}

function bindControls() {
  $$("#scenarioTabs button").forEach((button) => {
    button.addEventListener("click", () => choseScenario(button.dataset.scenario));
  });

  $$("#projectionControl button").forEach((button) => {
    button.addEventListener("click", () => {
      state.projection = button.dataset.value;
      setActiveSegment("projectionControl", state.projection);
      markDirty();
    });
  });

  $$("#resolutionControl button").forEach((button) => {
    button.addEventListener("click", () => {
      state.resolution = Number(button.dataset.value);
      setActiveSegment("resolutionControl", String(state.resolution));
      markDirty();
    });
  });

  $$("#normalMixControl button").forEach((button) => {
    button.addEventListener("click", () => {
      state.normalMix = Number(button.dataset.value);
      setActiveSegment("normalMixControl", button.dataset.value);
      scheduleRender();
    });
  });

  $$("#previewModeControl button").forEach((button) => {
    button.addEventListener("click", () => {
      state.previewMode = button.dataset.value;
      setActiveSegment("previewModeControl", state.previewMode);
      drawPreview();
    });
  });

  const rangeBindings = [
    ["rayDistance", "rayDistance", Number],
    ["cageOffset", "cageOffset", Number],
    ["weightScale", "weightScale", Number],
    ["maxHits", "maxHits", Number],
  ];
  for (const [id, key, parse] of rangeBindings) {
    $(`#${id}`).addEventListener("input", (event) => {
      state[key] = parse(event.target.value);
      updateSliderDisplays();
      markDirty();
    });
  }

  for (const [id, key] of [
    ["showLow", "showLow"],
    ["showHigh", "showHigh"],
    ["showWire", "showWire"],
    ["showBake", "showBake"],
  ]) {
    $(`#${id}`).addEventListener("change", (event) => {
      state[key] = event.target.checked;
      scheduleRender();
    });
  }

  $("#bakeCurrent").addEventListener("click", () => queueBake([state.active], 0));
  $("#bakeBoth").addEventListener("click", () => queueBake(["hard", "rounded"], 0));
  $("#resetCamera").addEventListener("click", () => {
    renderer.resetCamera();
    scheduleRender();
  });
}

function bindCamera() {
  const canvas = $("#viewport");
  let drag = null;
  canvas.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    renderer.orbit(event.clientX - drag.x, event.clientY - drag.y);
    drag = { x: event.clientX, y: event.clientY };
    scheduleRender();
  });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("pointercancel", () => { drag = null; });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    renderer.zoom(event.deltaY * 0.001);
    scheduleRender();
  }, { passive: false });
}

async function init() {
  bindControls();
  bindCamera();
  updateSliderDisplays();
  setStatus("正在加载 WASM 索引…", "busy");
  try {
    const [bakerInstance, scenarios] = await Promise.all([
      loadBaker("/baker.wasm"),
      Promise.resolve(buildScenarios(40)),
    ]);
    baker = bakerInstance;
    state.scenarios = scenarios;
    renderer.setLowMesh(scenarios.low);
    renderer.setHighMesh(scenarios.hard.high);
    updateSceneBadge();
    updateProjectionHelp();
    updateMetrics();
    drawPreview();
    scheduleRender();
    new ResizeObserver(scheduleRender).observe($("#viewport"));
    setStatus("WASM BVH 已就绪，开始双场景烘焙…", "busy");
    queueBake(["hard", "rounded"], 40);
  } catch (error) {
    console.error(error);
    setStatus(`初始化失败：${error.message}`, "busy");
    $("#rayNotice").hidden = false;
    $("#rayNotice").textContent = error.message;
  }
}

init();
