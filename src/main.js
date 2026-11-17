import {
  RENDER_HEIGHT,
  RENDER_WIDTH,
  TILE_SIZE,
  animateLights,
  buildTileLights,
  centerTiles,
  countCenterCrossings,
  createLights
} from "./lighting.js";
import { createHistogram, drawHeatmap } from "./heatmap.js";
import { LightingRenderer } from "./renderer.js";

const byId = (id) => document.getElementById(id);
const query = (selector) => document.querySelector(selector);
const elements = {
  tiledCanvas: byId("tiledCanvas"),
  referenceCanvas: byId("referenceCanvas"),
  diffCanvas: byId("diffCanvas"),
  heatCanvas: byId("heatCanvas"),
  heatButton: byId("heatButton"),
  pauseButton: byId("pauseButton"),
  pauseLabel: byId("pauseLabel"),
  pauseIcon: byId("pauseIcon"),
  sweepButton: byId("sweepButton"),
  lightChipCount: byId("lightChipCount"),
  referenceLoopLabel: byId("referenceLoopLabel"),
  tileSizeLabel: byId("tileSizeLabel"),
  heatStateLabel: byId("heatStateLabel"),
  tileMinLabel: byId("tileMinLabel"),
  tileMaxLabel: byId("tileMaxLabel"),
  tileMaxDuplicateLabel: byId("tileMaxDuplicateLabel"),
  heatLegendMax: byId("heatLegendMax"),
  histogram: byId("histogram"),
  diffZero: byId("diffZero"),
  diffZeroValue: query("#diffZero span"),
  deltaStatus: byId("deltaStatus"),
  boundaryStatus: byId("boundaryStatus"),
  probeDot: byId("probeDot"),
  crossingCount: byId("crossingCount"),
  crossingError: byId("crossingError"),
  matchPercent: byId("matchPercent"),
  mismatchCount: byId("mismatchCount"),
  comparedPixels: byId("comparedPixels"),
  matchBar: byId("matchBar"),
  frameTime: byId("frameTime"),
  tiledTests: byId("tiledTests"),
  referenceTests: byId("referenceTests"),
  savedPercent: byId("savedPercent"),
  occupiedTiles: byId("occupiedTiles"),
  avgTileLoad: byId("avgTileLoad"),
  p95TileLoad: byId("p95TileLoad"),
  overflowCount: byId("overflowCount"),
  webglError: byId("webglError")
};

const state = {
  paused: false,
  heatmap: true,
  stress: false,
  time: 3.15,
  previousCenters: null,
  crossings: 0,
  frames: 0,
  lastFrameAt: performance.now(),
  frameTimeAverage: 16.7,
  lastComparison: null,
  ready: false
};

const lights = createLights();
const heatContext = elements.heatCanvas.getContext("2d");
let renderers;
let tiles;

function formatCompact(value) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(Math.round(value));
}

function setStatus(element, text, tone = "good") {
  element.textContent = text;
  element.classList.remove("good", "warn", "bad");
  element.classList.add(tone);
}

function initializeRenderers() {
  try {
    renderers = {
      tiled: new LightingRenderer(elements.tiledCanvas, 0),
      reference: new LightingRenderer(elements.referenceCanvas, 1),
      diff: new LightingRenderer(elements.diffCanvas, 2)
    };
  } catch (error) {
    console.error(error);
    elements.webglError.hidden = false;
    return false;
  }
  return true;
}

function updateTileLabels() {
  const occupied = tiles.counts.reduce((sum, count) => sum + (count > 0 ? 1 : 0), 0);
  const totalTiles = tiles.columns * tiles.rows;
  const sorted = Array.from(tiles.counts).sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const average = tiles.totalEntries / totalTiles;
  const tiledTests = Array.from(tiles.counts).reduce(
    (sum, count) => sum + count * TILE_SIZE * TILE_SIZE,
    0
  );
  const referenceTests = RENDER_WIDTH * RENDER_HEIGHT * lights.length;
  const saved = 100 * (1 - tiledTests / referenceTests);

  elements.lightChipCount.textContent = String(lights.length);
  elements.referenceLoopLabel.textContent = String(lights.length);
  elements.tileSizeLabel.textContent = String(TILE_SIZE);
  elements.tileMinLabel.textContent = String(Math.min(...tiles.counts));
  elements.tileMaxLabel.textContent = String(tiles.maxLoad);
  elements.tileMaxDuplicateLabel.textContent = String(tiles.maxLoad);
  elements.heatLegendMax.textContent = String(Math.max(1, tiles.maxLoad));
  elements.occupiedTiles.textContent = `${occupied} / ${totalTiles}`;
  elements.avgTileLoad.textContent = average.toFixed(1);
  elements.p95TileLoad.textContent = String(p95);
  elements.overflowCount.textContent = String(tiles.overflow);
  elements.tiledTests.textContent = formatCompact(tiledTests);
  elements.referenceTests.textContent = formatCompact(referenceTests);
  elements.savedPercent.textContent = `${saved.toFixed(1)}%`;
  elements.comparedPixels.textContent = (RENDER_WIDTH * RENDER_HEIGHT).toLocaleString("en-US");
}

function comparePixels() {
  const tiled = renderers.tiled.readPixels();
  const reference = renderers.reference.readPixels();
  let mismatched = 0;
  let maximumDelta = 0;
  let accumulatedDelta = 0;
  const pixelCount = RENDER_WIDTH * RENDER_HEIGHT;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const redDelta = Math.abs(tiled[offset] - reference[offset]);
    const greenDelta = Math.abs(tiled[offset + 1] - reference[offset + 1]);
    const blueDelta = Math.abs(tiled[offset + 2] - reference[offset + 2]);
    const delta = Math.max(redDelta, greenDelta, blueDelta);
    if (delta > 0) {
      mismatched += 1;
    }
    maximumDelta = Math.max(maximumDelta, delta);
    accumulatedDelta += redDelta + greenDelta + blueDelta;
  }

  const result = {
    mismatched,
    pixelCount,
    maximumDelta,
    meanDelta: accumulatedDelta / (pixelCount * 3),
    matchPercent: 100 * (1 - mismatched / pixelCount)
  };
  state.lastComparison = result;

  elements.matchPercent.textContent = result.matchPercent.toFixed(3);
  elements.mismatchCount.textContent = mismatched.toLocaleString("en-US");
  elements.matchBar.style.width = `${result.matchPercent}%`;
  elements.matchBar.style.background =
    mismatched === 0
      ? "linear-gradient(90deg, var(--cyan), var(--mint))"
      : "linear-gradient(90deg, var(--amber), var(--coral))";
  elements.diffZeroValue.textContent =
    maximumDelta === 0 ? "0" : String(maximumDelta);
  elements.diffZero.classList.toggle("has-error", maximumDelta > 0);
  elements.crossingError.textContent = String(mismatched);

  if (mismatched === 0) {
    setStatus(elements.deltaStatus, "ZERO ERROR", "good");
    setStatus(elements.boundaryStatus, state.stress ? "SWEEPING" : "STABLE", "good");
  } else {
    setStatus(elements.deltaStatus, "MISMATCH", "bad");
    setStatus(elements.boundaryStatus, "LEAK DETECTED", "bad");
  }
  document.documentElement.dataset.ready = "true";
  return result;
}

function updateProbeReadout() {
  const probe = lights.find((light) => light.isProbe);
  if (!probe) {
    return;
  }
  const screenX = probe.x * RENDER_WIDTH;
  const distanceToBoundary = Math.abs(screenX / TILE_SIZE - Math.round(screenX / TILE_SIZE));
  elements.probeDot.style.left = `${8 + probe.x * 84}%`;
  elements.probeDot.style.opacity = String(0.72 + Math.min(1, distanceToBoundary * 5) * 0.28);
  elements.probeDot.style.background =
    distanceToBoundary < 0.18 ? "#fff" : "#fff4c9";
}

function drawFrame(now, renderPass = true) {
  if (!renderers) {
    return;
  }
  const elapsed = Math.min(0.05, Math.max(0, (now - state.lastFrameAt) / 1000));
  state.lastFrameAt = now;
  if (!state.paused) {
    state.time += elapsed;
  }

  animateLights(lights, state.time, state.stress);
  tiles = buildTileLights(
    lights,
    RENDER_WIDTH,
    RENDER_HEIGHT,
    TILE_SIZE
  );

  const centers = centerTiles(tiles);
  state.crossings += countCenterCrossings(state.previousCenters, centers);
  state.previousCenters = centers;

  if (renderPass) {
    const renderStart = performance.now();
    renderers.tiled.render(tiles, lights);
    renderers.reference.render(tiles, lights);
    renderers.diff.render(tiles, lights);
    const renderCost = performance.now() - renderStart;
    state.frameTimeAverage += (renderCost - state.frameTimeAverage) * 0.08;
    elements.frameTime.textContent = `${state.frameTimeAverage.toFixed(1)} MS`;
  }

  updateTileLabels();
  updateProbeReadout();
  elements.crossingCount.textContent =
    state.crossings > 9999 ? `${(state.crossings / 1000).toFixed(1)}K` : String(state.crossings);

  if (state.heatmap) {
    drawHeatmap(heatContext, tiles);
  }

  if (state.frames % 8 === 0) {
    createHistogram(elements.histogram, tiles);
  }
  if (state.frames % 8 === 0 || !state.lastComparison) {
    comparePixels();
  }

  state.frames += 1;
  state.ready = true;
}

function animationLoop(now) {
  drawFrame(now);
  requestAnimationFrame(animationLoop);
}

function bindControls() {
  elements.pauseButton.addEventListener("click", () => {
    state.paused = !state.paused;
    elements.pauseLabel.textContent = state.paused ? "Resume" : "Pause";
    elements.pauseIcon.textContent = state.paused ? "▶" : "Ⅱ";
    elements.pauseButton.classList.toggle("is-active", state.paused);
  });

  elements.heatButton.addEventListener("click", () => {
    state.heatmap = !state.heatmap;
    elements.heatButton.classList.toggle("is-active", state.heatmap);
    elements.heatButton.setAttribute("aria-pressed", String(state.heatmap));
    elements.heatCanvas.classList.toggle("is-hidden", !state.heatmap);
    elements.heatStateLabel.textContent = state.heatmap ? "ON" : "OFF";
    if (!state.heatmap) {
      heatContext.clearRect(0, 0, elements.heatCanvas.width, elements.heatCanvas.height);
    }
  });

  elements.sweepButton.addEventListener("click", () => {
    state.stress = !state.stress;
    elements.sweepButton.classList.toggle("is-active", state.stress);
    elements.sweepButton.setAttribute("aria-pressed", String(state.stress));
    setStatus(
      elements.boundaryStatus,
      state.stress ? "SWEEPING" : "STABLE",
      "good"
    );
  });
}

function exposeDebugApi() {
  window.__tilefield = {
    get lights() {
      return lights;
    },
    get tiles() {
      return tiles;
    },
    get state() {
      return state;
    },
    get renderers() {
      return renderers;
    },
    compareNow() {
      return comparePixels();
    },
    setTime(value) {
      state.time = value;
      state.paused = true;
      drawFrame(performance.now(), true);
      return comparePixels();
    },
    step(seconds = 1 / 60) {
      state.time += seconds;
      drawFrame(performance.now(), true);
      return state.lastComparison;
    }
  };
}

function boot() {
  elements.comparedPixels.textContent = (RENDER_WIDTH * RENDER_HEIGHT).toLocaleString("en-US");
  if (!initializeRenderers()) {
    return;
  }
  bindControls();
  exposeDebugApi();
  animateLights(lights, state.time, state.stress);
  drawFrame(performance.now(), true);
  requestAnimationFrame(animationLoop);
}

boot();
