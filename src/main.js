import { fragmentShader, vertexShader } from "./shaders.js";

const PRESETS = [
  {
    id: "metal",
    name: "金属",
    english: "METAL",
    color: "#d1aa6d",
    roughness: 0.13,
    metalness: 1,
  },
  {
    id: "ceramic",
    name: "陶瓷",
    english: "CERAMIC",
    color: "#e7e1d3",
    roughness: 0.29,
    metalness: 0,
  },
  {
    id: "plastic",
    name: "磨砂塑料",
    english: "MATTE PLASTIC",
    color: "#c66f58",
    roughness: 0.72,
    metalness: 0,
  },
];

const state = {
  toneMode: "aces",
  exposure: 0,
  showDiffuse: true,
  showSpecular: true,
  showDirect: true,
  showIBL: true,
  showNormal: true,
  normalStrength: 0.65,
  environmentRotation: 0,
  materials: PRESETS.map(({ id, color, roughness, metalness }) => ({
    id,
    color,
    roughness,
    metalness,
  })),
  stats: [],
};

const canvas = document.querySelector("#pbr-canvas");
const materialList = document.querySelector("#material-list");
const readoutBody = document.querySelector("#readout-body");
const energyNote = document.querySelector("#energy-note");
const gl = canvas.getContext("webgl2", {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: true,
  powerPreference: "high-performance",
});

let program;
let statsTarget;
let statsDirty = true;
let renderQueued = false;
let lastStatsTime = 0;
const uniform = {};

function srgbToLinear(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed:\n${message}`);
  }
  return shader;
}

function createProgram() {
  const vertex = compileShader(gl.VERTEX_SHADER, vertexShader);
  const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentShader);
  const nextProgram = gl.createProgram();
  gl.attachShader(nextProgram, vertex);
  gl.attachShader(nextProgram, fragment);
  gl.linkProgram(nextProgram);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
    throw new Error(`Program link failed:\n${gl.getProgramInfoLog(nextProgram)}`);
  }
  return nextProgram;
}

function showFatalError(error) {
  console.error(error);
  const message = document.createElement("div");
  message.className = "fatal-error";
  message.innerHTML = `<strong>WebGL2 初始化失败</strong><span>${String(error.message || error)}</span>`;
  document.querySelector(".stage").append(message);
}

function initializeWebGL() {
  if (!gl) {
    throw new Error("当前浏览器不支持 WebGL2。");
  }
  program = createProgram();
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const names = [
    "u_resolution",
    "u_cameraBasis",
    "u_cameraPos",
    "u_focal",
    "u_envRotation",
    "u_exposure",
    "u_toneMode",
    "u_showDiffuse",
    "u_showSpecular",
    "u_showDirect",
    "u_showIBL",
    "u_showNormal",
    "u_normalStrength",
    "u_baseColor",
    "u_materialProps",
    "u_statsPass",
  ];
  names.forEach((name) => {
    uniform[name] = gl.getUniformLocation(program, name);
  });

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
}

function updateRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const percentage = ((value - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${percentage}%`);
}

function requestRender({ stats = true } = {}) {
  if (stats) {
    statsDirty = true;
  }
  if (renderQueued) {
    return;
  }
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderFrame();
  });
}

function cameraSetup(aspect = 1.15) {
  const position = [0, 0.5, 8.4];
  const target = [0, -0.18, 0];
  const forward = normalize(subtract(target, position));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = normalize(cross(right, forward));
  const baseFocal = 1 / Math.tan((41 * Math.PI) / 360);
  return {
    position,
    basis: new Float32Array([
      right[0], right[1], right[2],
      up[0], up[1], up[2],
      forward[0], forward[1], forward[2],
    ]),
    focal: baseFocal * Math.min(1, Math.max(0.6, aspect / 1.12)),
  };
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((component) => component / length);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const pixelBudgetScale = Math.sqrt(3_200_000 / Math.max(rect.width * rect.height, 1));
  const scale = Math.min(2, Math.max(1.45, window.devicePixelRatio || 1), pixelBudgetScale);
  const width = Math.max(2, Math.round(rect.width * scale));
  const height = Math.max(2, Math.round(rect.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, aspect: width / height };
}

function setSceneUniforms(width, height, statsPass) {
  const camera = cameraSetup(width / height);
  const baseColors = new Float32Array(9);
  const materialProps = new Float32Array(6);
  state.materials.forEach((material, index) => {
    baseColors.set(srgbToLinear(material.color), index * 3);
    materialProps[index * 2] = material.roughness;
    materialProps[index * 2 + 1] = material.metalness;
  });

  gl.uniform2f(uniform.u_resolution, width, height);
  gl.uniformMatrix3fv(uniform.u_cameraBasis, false, camera.basis);
  gl.uniform3fv(uniform.u_cameraPos, camera.position);
  gl.uniform1f(uniform.u_focal, camera.focal);
  gl.uniform1f(uniform.u_envRotation, state.environmentRotation);
  gl.uniform1f(uniform.u_exposure, state.exposure);
  gl.uniform1i(uniform.u_toneMode, state.toneMode === "aces" ? 0 : 1);
  gl.uniform1i(uniform.u_showDiffuse, state.showDiffuse ? 1 : 0);
  gl.uniform1i(uniform.u_showSpecular, state.showSpecular ? 1 : 0);
  gl.uniform1i(uniform.u_showDirect, state.showDirect ? 1 : 0);
  gl.uniform1i(uniform.u_showIBL, state.showIBL ? 1 : 0);
  gl.uniform1i(uniform.u_showNormal, state.showNormal ? 1 : 0);
  gl.uniform1f(uniform.u_normalStrength, state.normalStrength);
  gl.uniform3fv(uniform.u_baseColor, baseColors);
  gl.uniform2fv(uniform.u_materialProps, materialProps);
  gl.uniform1i(uniform.u_statsPass, statsPass ? 1 : 0);
}

function drawScene(width, height, statsPass = false) {
  gl.viewport(0, 0, width, height);
  gl.useProgram(program);
  setSceneUniforms(width, height, statsPass);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function ensureStatsTarget() {
  if (statsTarget || !gl.getExtension("EXT_color_buffer_float")) {
    return Boolean(statsTarget);
  }
  const width = 480;
  const height = Math.max(240, Math.round(width / Math.max(canvas.width / canvas.height, 0.5)));
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return false;
  }
  statsTarget = { framebuffer, texture, width, height };
  return true;
}

function luminance(red, green, blue) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function readStats() {
  if (!ensureStatsTarget()) {
    return null;
  }
  const { framebuffer, width, height } = statsTarget;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  drawScene(width, height, true);
  const pixels = new Float32Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (gl.getError() !== gl.NO_ERROR) {
    return null;
  }

  const sums = [0, 0, 0];
  const peaks = [0, 0, 0];
  const counts = [0, 0, 0];
  const samples = [[], [], []];
  let hottest = [0, 0, 0];
  let hottestY = -1;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const id = Math.round(pixels[index + 3]);
    const value = luminance(red, green, blue);
    if (id >= 1 && id <= 3) {
      sums[id - 1] += value;
      peaks[id - 1] = Math.max(peaks[id - 1], value);
      counts[id - 1] += 1;
      samples[id - 1].push(value);
    }
    if (value > hottestY) {
      hottestY = value;
      hottest = [red, green, blue];
    }
  }

  const results = sums.map((sum, index) => {
    const sorted = samples[index].sort((a, b) => a - b);
    const percentileIndex = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * 0.995)));
    return {
      average: counts[index] ? sum / counts[index] : 0,
      peak: sorted[percentileIndex] ?? 0,
      maximum: peaks[index],
      pixels: counts[index],
    };
  });
  return { materials: results, hottest, hottestY };
}

function displayChroma(hdr) {
  const exposed = hdr.map((channel) => channel * Math.pow(2, state.exposure));
  const mapped = exposed.map((channel) => {
    if (state.toneMode === "linear") {
      return Math.min(Math.max(channel, 0), 1);
    }
    return Math.min(Math.max((channel * (2.51 * channel + 0.03)) / (channel * (2.43 * channel + 0.59) + 0.14), 0), 1);
  });
  const maximum = Math.max(...mapped);
  const minimum = Math.min(...mapped);
  return maximum > 0.0001 ? (maximum - minimum) / maximum : 0;
}

function formatMetric(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (value > 99.5) {
    return value.toFixed(0);
  }
  if (value > 9.95) {
    return value.toFixed(1);
  }
  return value.toFixed(3);
}

function highlightStatus(material, stats) {
  if (!state.showSpecular) {
    return "—";
  }
  if (material.metalness > 0.985) {
    return "锁零";
  }
  if (material.roughness < 0.35) {
    return "紧凑";
  }
  return stats?.peak > 0 ? "宽峰" : "—";
}

function updateReadout() {
  readoutBody.replaceChildren();
  PRESETS.forEach((preset, index) => {
    const stats = state.stats[index];
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="material-swatch" style="background:${preset.color}"></span>${preset.name}</td>
      <td>${formatMetric(stats?.average ?? 0)}</td>
      <td>${formatMetric(stats?.peak ?? 0)}</td>
      <td>${highlightStatus(state.materials[index], stats)}</td>
    `;
    readoutBody.append(row);
  });

  let message = "金属漫反射锁零 · 高光滚降保持中性";
  let warning = false;
  const hottest = state.stats.raw?.hottest;
  const chroma = hottest ? displayChroma(hottest) : 0;

  if (!state.showDiffuse) {
    message = "当前关闭漫反射：画面仅保留高光响应";
    warning = true;
  } else if (!state.showSpecular) {
    message = "当前关闭高光：画面仅保留漫反射响应";
    warning = true;
  } else if (!state.showDirect && !state.showIBL) {
    message = "直接光与环境光均已关闭";
    warning = true;
  } else if (state.materials[0].metalness < 0.985) {
    message = "金属度低于 1：金属会出现不应有的漫反射";
    warning = true;
  } else if (chroma > 0.22) {
    message = `最亮区域色偏偏大：ΔC ${chroma.toFixed(3)}`;
    warning = true;
  } else {
    message = `金属漫反射锁零 · 最亮区 ΔC ${chroma.toFixed(3)}`;
  }

  energyNote.classList.toggle("warn", warning);
  energyNote.innerHTML = `<span class="status-icon">${warning ? "!" : "✓"}</span><span>${message}</span>`;
}

function createMaterialControls() {
  materialList.replaceChildren();
  PRESETS.forEach((preset, index) => {
    const card = document.createElement("article");
    card.className = "material-card";
    card.dataset.material = preset.id;
    card.innerHTML = `
      <div class="material-name">
        <i class="dot" style="background:${preset.color}"></i>${preset.name}
        <small>${preset.english}</small>
      </div>
      <label class="control-row range-row">
        <span>粗糙度 <output data-output="roughness">${state.materials[index].roughness.toFixed(2)}</output></span>
        <input data-property="roughness" type="range" min="0.03" max="1" step="0.01" value="${state.materials[index].roughness}" aria-label="${preset.name}粗糙度" />
      </label>
      <label class="control-row range-row">
        <span>金属度 <output data-output="metalness">${state.materials[index].metalness.toFixed(2)}</output></span>
        <input data-property="metalness" type="range" min="0" max="1" step="0.01" value="${state.materials[index].metalness}" aria-label="${preset.name}金属度" />
      </label>
    `;
    card.querySelectorAll('input[type="range"]').forEach((input) => {
      updateRangeFill(input);
      input.addEventListener("input", () => {
        const property = input.dataset.property;
        const value = Number(input.value);
        state.materials[index][property] = value;
        card.querySelector(`[data-output="${property}"]`).textContent = value.toFixed(2);
        updateRangeFill(input);
        requestRender();
      });
    });
    materialList.append(card);
  });
}

function bindToggle(id, key) {
  const input = document.querySelector(id);
  input.addEventListener("change", () => {
    state[key] = input.checked;
    requestRender();
  });
}

function bindControls() {
  const toneMode = document.querySelector("#tone-mode");
  const exposure = document.querySelector("#exposure");
  const exposureValue = document.querySelector("#exposure-value");
  const normalStrength = document.querySelector("#normal-strength");
  const normalValue = document.querySelector("#normal-value");

  toneMode.addEventListener("change", () => {
    state.toneMode = toneMode.value;
    requestRender();
  });
  exposure.addEventListener("input", () => {
    state.exposure = Number(exposure.value);
    exposureValue.textContent = `${state.exposure.toFixed(1)} EV`;
    updateRangeFill(exposure);
    requestRender();
  });
  normalStrength.addEventListener("input", () => {
    state.normalStrength = Number(normalStrength.value);
    normalValue.textContent = state.normalStrength.toFixed(2);
    updateRangeFill(normalStrength);
    requestRender();
  });

  bindToggle("#show-diffuse", "showDiffuse");
  bindToggle("#show-specular", "showSpecular");
  bindToggle("#show-direct", "showDirect");
  bindToggle("#show-ibl", "showIBL");
  bindToggle("#show-normal", "showNormal");

  updateRangeFill(exposure);
  updateRangeFill(normalStrength);
  document.querySelector("#reset").addEventListener("click", resetPresets);
}

function resetPresets() {
  state.toneMode = "aces";
  state.exposure = 0;
  state.showDiffuse = true;
  state.showSpecular = true;
  state.showDirect = true;
  state.showIBL = true;
  state.showNormal = true;
  state.normalStrength = 0.65;
  state.environmentRotation = 0;
  state.materials = PRESETS.map(({ id, color, roughness, metalness }) => ({
    id,
    color,
    roughness,
    metalness,
  }));
  state.stats = [];

  document.querySelector("#tone-mode").value = "aces";
  document.querySelector("#exposure").value = "0";
  document.querySelector("#exposure-value").textContent = "0.0 EV";
  document.querySelector("#normal-strength").value = "0.65";
  document.querySelector("#normal-value").textContent = "0.65";
  ["show-diffuse", "show-specular", "show-direct", "show-ibl", "show-normal"].forEach((id) => {
    document.querySelector(`#${id}`).checked = true;
  });
  updateRangeFill(document.querySelector("#exposure"));
  updateRangeFill(document.querySelector("#normal-strength"));
  createMaterialControls();
  updateReadout();
  requestRender();
}

function scheduleStatsRefresh() {
  window.clearTimeout(scheduleStatsRefresh.timeout);
  scheduleStatsRefresh.timeout = window.setTimeout(() => {
    statsDirty = true;
    requestRender();
  }, 110);
}

function renderFrame() {
  const { width, height } = resizeCanvas();
  const now = performance.now();
  if (statsDirty && now - lastStatsTime >= 90) {
    const result = readStats();
    lastStatsTime = now;
    statsDirty = false;
    if (result) {
      state.stats = result.materials;
      state.stats.raw = result;
      updateReadout();
    }
  } else if (statsDirty) {
    scheduleStatsRefresh();
  }
  drawScene(width, height, false);
}

function bindStageInteraction() {
  let drag = null;
  canvas.addEventListener("pointerdown", (event) => {
    drag = { pointerId: event.pointerId, x: event.clientX };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const delta = event.clientX - drag.x;
    drag.x = event.clientX;
    state.environmentRotation -= delta * 0.006;
    requestRender({ stats: false });
    scheduleStatsRefresh();
  });
  const endDrag = (event) => {
    if (drag?.pointerId === event.pointerId) {
      drag = null;
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", endDrag);

  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey) {
      state.environmentRotation = 0;
      requestRender();
    }
  });
  new ResizeObserver(() => requestRender()).observe(canvas);
}

function initialize() {
  try {
    initializeWebGL();
    createMaterialControls();
    bindControls();
    bindStageInteraction();
    updateReadout();
    requestRender();
    document.documentElement.dataset.webglReady = "true";
    window.__PBR_LAB__ = {
      state,
      presets: PRESETS,
      getStats: () => state.stats,
      render: () => requestRender(),
    };
  } catch (error) {
    showFatalError(error);
  }
}

initialize();
