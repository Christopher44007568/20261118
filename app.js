"use strict";

/* HDR Framebuffer Lab
 * Pass 1: procedural HDR scene -> RGBA16F float framebuffer (values may exceed 1.0)
 * Pass 2: shared exposure + tonemap/transfer -> RGBA8 display texture
 */

const HALF_FLOAT_MAX = 65504;
const PQ_PEAK_NITS = 1000;
const SDR_PEAK_NITS = 100;

window.__hdrLab = { ready: false };

const canvas = document.getElementById("gl-canvas");
const gl = canvas.getContext("webgl2", {
  antialias: false,
  preserveDrawingBuffer: false,
});
if (!gl) {
  document.body.innerHTML = "<p style='padding:24px'>WebGL2 is required for this lab.</p>";
  throw new Error("WebGL2 unavailable");
}
const floatExt = gl.getExtension("EXT_color_buffer_float");
if (!floatExt) {
  document.body.innerHTML = "<p style='padding:24px'>EXT_color_buffer_float is required.</p>";
  throw new Error("float color buffer unavailable");
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error("shader compile failed: " + log);
  }
  return shader;
}

function createProgram(vsSource, fsSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error("program link failed: " + gl.getProgramInfoLog(program));
  }
  return program;
}

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const SCENE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_resolution;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float sdCircle(vec2 p, float r) { return length(p) - r; }

float ringGlow(vec2 p, float r, float w) {
  return 1.0 - smoothstep(0.0, w, abs(length(p) - r));
}

void main() {
  vec2 uv = v_uv;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float aspect = u_resolution.x / u_resolution.y;
  // Keep the composition inside the frame on narrow (portrait) viewports.
  vec2 layoutShift = vec2((1.58 - aspect) * 0.3, 0.0);
  vec2 q = p + layoutShift;

  // deep-space background with vertical gradient and faint vignette
  vec3 col = mix(vec3(0.012, 0.020, 0.045), vec3(0.004, 0.006, 0.014), uv.y);

  // wide soft nebulae: warm behind the planet, cool on the left
  float nebW = exp(-pow(length((q - vec2(0.22, 0.17)) * vec2(0.9, 1.2)), 2.0) * 1.7);
  float nebC = exp(-pow(length((q - vec2(-0.42, -0.04)) * vec2(1.0, 1.3)), 2.0) * 2.4);
  col += vec3(0.28, 0.11, 0.06) * nebW * 0.42;
  col += vec3(0.025, 0.14, 0.21) * nebC * 0.35;

  // sparse star field of small squares (sub-1.0 linear)
  vec2 starCell = vec2(u_resolution.x / 11.0, u_resolution.y / 11.0);
  vec2 starGrid = floor(uv * starCell);
  vec2 starFrac = fract(uv * starCell);
  float starCellOn = step(0.975, hash21(starGrid));
  float starDot = 1.0 - smoothstep(0.08, 0.22, length(starFrac - 0.5));
  float star = starCellOn * starDot;
  col += vec3(0.45, 0.58, 0.85) * star * 0.5;

  // HDR planet: dense warm-white core (~22x) wrapped in a soft falloff halo
  vec2 planetP = q - vec2(0.22, 0.17);
  const float planetR = 0.072;
  float planetD = sdCircle(planetP, planetR);
  float core = 1.0 - smoothstep(0.0, planetR, max(planetD, 0.0));
  vec3 planetColor = vec3(21.4, 20.4, 17.8) * core;
  float halo = exp(-max(planetD, 0.0) * 11.0);
  col += planetColor + vec3(0.7, 0.38, 0.18) * halo * 0.7;

  // tilted ring around the planet (additive, HDR)
  float ringA = radians(-12.0);
  vec2 ringLocal = mat2(cos(ringA), -sin(ringA), sin(ringA), cos(ringA)) * planetP;
  ringLocal.y *= 2.9; // flatten the disk into a near edge-on elliptical ring
  float ring = ringGlow(ringLocal, 0.175, 0.012);
  float outside = smoothstep(planetR * 1.02, planetR * 1.18, length(planetP));
  float backArc = 0.35 + 0.65 * step(0.0, ringLocal.y);
  col += vec3(0.9, 1.05, 1.4) * ring * outside * backArc * 1.7;

  // narrow vertical light beams (HDR, cool left / warm right)
  float beamL = exp(-abs(q.x + 0.33) * 130.0) * smoothstep(-0.33, -0.04, q.y);
  float beamR = exp(-abs(q.x - 0.39) * 150.0) * smoothstep(-0.31, -0.08, q.y);
  col += vec3(0.22, 1.0, 1.3) * beamL * 4.6;
  col += vec3(1.5, 0.75, 0.32) * beamR * 3.4;

  // horizon glow line
  float horizon = exp(-abs(q.y + 0.305) * 45.0);
  col += vec3(0.12, 0.3, 0.46) * horizon * 0.55;

  // city silhouette: varied building heights with lit windows
  float ground = step(q.y, -0.30);
  vec2 cityId = floor(vec2((q.x + 1.0) * 26.0, 0.0));
  float hgt = 0.05 + 0.14 * hash21(cityId + 3.1);
  float bld = step(-0.30 - hgt, q.y) * ground;
  vec2 winGrid = vec2((q.x + 1.0) * 150.0, (q.y + 0.30) * 95.0);
  vec2 win = fract(winGrid);
  float winMask = step(0.62, win.x) * step(0.6, win.y);
  float lit = step(0.62, hash21(floor(winGrid)));
  vec3 windowWarm = vec3(1.9, 1.25, 0.55);
  vec3 windowCool = vec3(0.5, 1.2, 1.6);
  vec3 windowCol = mix(windowWarm, windowCool, step(0.5, hash21(cityId)));
  col = mix(col, vec3(0.006, 0.009, 0.018), bld);
  col += windowCol * winMask * lit * bld * 1.25;
  col = mix(col, vec3(0.003, 0.005, 0.011), ground * (1.0 - bld));

  outColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

const TONEMAP_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_scene;
uniform float u_exposure;   // linear multiplier, shared between SDR and HDR
uniform int u_mode;         // 0 = SDR, 1 = HDR/PQ

// Narkowicz ACES filmic approximation, input is scene-linear
vec3 acesFilm(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 srgbEncode(vec3 x) {
  return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x));
}

// BT.2100 PQ OETF, e = normalized linear light (1.0 == 10000 nit reference)
vec3 pqEncode(vec3 e) {
  const float m1 = 0.1593017578125;
  const float m2 = 78.84375;
  const float c1 = 0.8359375;
  const float c2 = 18.8515625;
  const float c3 = 18.6875;
  vec3 ep = pow(max(e, vec3(0.0)), vec3(m1));
  return pow((c1 + c2 * ep) / (1.0 + c3 * ep), vec3(m2));
}

void main() {
  vec3 hdr = texture(u_scene, v_uv).rgb;
  vec3 exposed = hdr * u_exposure;

  if (u_mode == 0) {
    // SDR: ACES tone map to [0,1] Rec.709 linear, then sRGB transfer
    vec3 displayLinear = acesFilm(exposed);
    outColor = vec4(srgbEncode(displayLinear), 1.0);
  } else {
    // HDR: extended Reinhard keeps headroom up to the 1000 nit display peak,
    // then PQ (ST.2084) transfer. Same exposure baseline as the SDR path.
    vec3 nits = exposed / (1.0 + exposed) * 1000.0;
    vec3 pqLinear = nits / 10000.0;
    outColor = vec4(pqEncode(pqLinear), 1.0);
  }
}`;

const sceneProgram = createProgram(VERT, SCENE_FRAG);
const tonemapProgram = createProgram(VERT, TONEMAP_FRAG);

const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([-1, -1, 3, -1, -1, 3]),
  gl.STATIC_DRAW
);

function bindQuad(program) {
  const loc = gl.getAttribLocation(program, "a_pos");
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

const floatFbo = gl.createFramebuffer();
const floatTex = gl.createTexture();
const displayFbo = gl.createFramebuffer();
const displayTex = gl.createTexture();
const depthRbo = gl.createRenderbuffer();

let renderWidth = 0;
let renderHeight = 0;

function allocateTargets(width, height) {
  renderWidth = width;
  renderHeight = height;

  // intermediate RGBA16F scene buffer: stores linear HDR, values may pass 1.0
  gl.bindTexture(gl.TEXTURE_2D, floatTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindRenderbuffer(gl.RENDERBUFFER, depthRbo);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);

  gl.bindFramebuffer(gl.FRAMEBUFFER, floatFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, floatTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRbo);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("RGBA16F framebuffer is not complete");
  }

  // final RGBA8 display texture: only the tonemap pass may touch 8-bit storage
  gl.bindTexture(gl.TEXTURE_2D, displayTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, displayFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, displayTex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("RGBA8 framebuffer is not complete");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

const state = {
  mode: "sdr",          // "sdr" | "hdr"
  evStops: 0,           // single shared exposure control
  cssWidth: 0,
  cssHeight: 0,
  metrics: null,
};

const sceneUniforms = {};
const toneUniforms = {};

function cacheUniforms() {
  sceneUniforms.resolution = gl.getUniformLocation(sceneProgram, "u_resolution");
  toneUniforms.scene = gl.getUniformLocation(tonemapProgram, "u_scene");
  toneUniforms.exposure = gl.getUniformLocation(tonemapProgram, "u_exposure");
  toneUniforms.mode = gl.getUniformLocation(tonemapProgram, "u_mode");
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(2, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(2, Math.round(canvas.clientHeight * dpr));
  if (width === renderWidth && height === renderHeight) return false;
  canvas.width = width;
  canvas.height = height;
  allocateTargets(width, height);
  state.cssWidth = canvas.clientWidth;
  state.cssHeight = canvas.clientHeight;
  return true;
}

function renderScene() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, floatFbo);
  gl.viewport(0, 0, renderWidth, renderHeight);
  gl.disable(gl.BLEND);
  gl.useProgram(sceneProgram);
  bindQuad(sceneProgram);
  gl.uniform2f(sceneUniforms.resolution, renderWidth, renderHeight);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function renderDisplay() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, displayFbo);
  gl.viewport(0, 0, renderWidth, renderHeight);
  gl.useProgram(tonemapProgram);
  bindQuad(tonemapProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, floatTex);
  gl.uniform1i(toneUniforms.scene, 0);
  gl.uniform1f(toneUniforms.exposure, Math.pow(2, state.evStops));
  gl.uniform1i(toneUniforms.mode, state.mode === "hdr" ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function blitToCanvas() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, renderWidth, renderHeight);
  gl.useProgram(tonemapProgram);
  bindQuad(tonemapProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, floatTex);
  gl.uniform1i(toneUniforms.scene, 0);
  gl.uniform1f(toneUniforms.exposure, Math.pow(2, state.evStops));
  gl.uniform1i(toneUniforms.mode, state.mode === "hdr" ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

let rafHandle = 0;
let needsRender = true;

function frame(now) {
  rafHandle = requestAnimationFrame(frame);
  const resized = resizeCanvas();
  renderScene();
  renderDisplay();
  blitToCanvas();
  if (needsRender || resized) {
    needsRender = false;
    collectMetrics();
    updateReadout();
  }
}

function readFloatBuffer() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, floatFbo);
  const pixels = new Float32Array(renderWidth * renderHeight * 4);
  gl.readPixels(0, 0, renderWidth, renderHeight, gl.RGBA, gl.FLOAT, pixels);
  return pixels;
}

function readDisplayBuffer() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, displayFbo);
  const pixels = new Uint8Array(renderWidth * renderHeight * 4);
  gl.readPixels(0, 0, renderWidth, renderHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

function acesFilm(x) {
  const v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return Math.min(1, Math.max(0, v));
}

function srgbEncode(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function pqEncode(e) {
  const m1 = 0.1593017578125;
  const m2 = 78.84375;
  const c1 = 0.8359375;
  const c2 = 18.8515625;
  const c3 = 18.6875;
  const ep = Math.pow(Math.max(0, e), m1);
  return Math.pow((c1 + c2 * ep) / (1 + c3 * ep), m2);
}

function pqDecode(v) {
  const n = Math.pow(Math.max(0, v), 1 / 78.84375);
  const num = Math.max(0, n - 0.8359375);
  const den = 18.8515625 - 18.6875 * n;
  return 10000 * Math.pow(num / den, 1 / 0.1593017578125);
}

// Probes are expressed in the same aspect-corrected scene space as the shader,
// so they lock onto the same physical feature at every window size.
const PLANET_CENTER = { x: 0.22, y: 0.17 };
const HIGHLIGHT_OFFSET = { x: -0.108, y: 0.052 };
const SHADOW_SCENE = { x: -0.72, y: -0.55 };

function sceneToUv(point) {
  const aspect = renderWidth / renderHeight;
  const shift = (1.58 - aspect) * 0.3;
  return {
    x: 0.5 + (point.x - shift) / aspect,
    y: 0.5 - point.y,
  };
}

function probePixel(buf, width, height, point, channels) {
  const px = Math.min(width - 1, Math.max(0, Math.floor(point.x * width)));
  const py = Math.min(height - 1, Math.max(0, Math.floor((1 - point.y) * height)));
  const idx = (py * width + px) * channels;
  return Array.from(buf.slice(idx, idx + channels));
}

// Average a small 3x3 neighborhood so readouts stay stable across window sizes.
function probeAverage(buf, width, height, point) {
  const cx = Math.floor(point.x * width);
  const cy = Math.floor((1 - point.y) * height);
  const acc = [0, 0, 0];
  let samples = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const px = Math.min(width - 1, Math.max(0, cx + ox));
      const py = Math.min(height - 1, Math.max(0, cy + oy));
      const idx = (py * width + px) * 4;
      acc[0] += buf[idx];
      acc[1] += buf[idx + 1];
      acc[2] += buf[idx + 2];
      samples++;
    }
  }
  return acc.map((v) => v / samples);
}

function displayValueFromLinear(linearRgb) {
  const exposure = Math.pow(2, state.evStops);
  const exposed = linearRgb.map((c) => c * exposure);
  const byte = [0, 0, 0, 255];
  let nits;
  if (state.mode === "sdr") {
    for (let i = 0; i < 3; i++) {
      byte[i] = Math.round(Math.min(1, Math.max(0, srgbEncode(acesFilm(exposed[i])))) * 255);
    }
    nits = (Math.max(byte[0], byte[1], byte[2]) / 255) * SDR_PEAK_NITS;
  } else {
    for (let i = 0; i < 3; i++) {
      const n = (exposed[i] / (1 + exposed[i])) * PQ_PEAK_NITS;
      byte[i] = Math.round(Math.min(1, Math.max(0, pqEncode(n / 10000))) * 255);
    }
    const peakCode = Math.max(byte[0], byte[1], byte[2]) / 255;
    nits = pqDecode(peakCode);
  }
  return { byte, nits };
}

function collectMetrics() {
  const floatPixels = readFloatBuffer();
  const displayPixels = readDisplayBuffer();
  const count = renderWidth * renderHeight;

  let peak = 0;
  let bufferClipped = 0;
  for (let i = 0; i < count; i++) {
    const r = floatPixels[i * 4];
    const g = floatPixels[i * 4 + 1];
    const b = floatPixels[i * 4 + 2];
    const m = Math.max(r, g, b);
    if (m > peak) peak = m;
    if (!Number.isFinite(m) || m >= HALF_FLOAT_MAX) bufferClipped++;
  }

  let displayClip = 0;
  for (let i = 0; i < count; i++) {
    const r = displayPixels[i * 4];
    const g = displayPixels[i * 4 + 1];
    const b = displayPixels[i * 4 + 2];
    if (r === 255 || g === 255 || b === 255) displayClip++;
  }

  const highlightUv = sceneToUv({
    x: PLANET_CENTER.x + HIGHLIGHT_OFFSET.x,
    y: PLANET_CENTER.y + HIGHLIGHT_OFFSET.y,
  });
  const shadowUv = sceneToUv(SHADOW_SCENE);
  const highlightLinear = probeAverage(floatPixels, renderWidth, renderHeight, highlightUv);
  const shadowLinear = probeAverage(floatPixels, renderWidth, renderHeight, shadowUv);
  const highlight = displayValueFromLinear(highlightLinear);
  const shadow = displayValueFromLinear(shadowLinear);

  state.metrics = {
    width: renderWidth,
    height: renderHeight,
    cssWidth: state.cssWidth,
    cssHeight: state.cssHeight,
    peak,
    bufferClipped,
    displayClip,
    highlight,
    shadow,
  };
  window.__hdrLab.metrics = state.metrics;
  window.__hdrLab.state = {
    mode: state.mode,
    evStops: state.evStops,
    exposure: Math.pow(2, state.evStops),
  };
}

const el = (id) => document.getElementById(id);
const refs = {
  peakLinear: el("peak-linear"),
  bufferClipped: el("buffer-clipped"),
  evReadout: el("ev-readout"),
  evSlider: el("ev-slider"),
  resetEv: el("reset-ev"),
  curveLabel: el("curve-label"),
  modeButtons: document.querySelectorAll(".mode-btn"),
  roMode: el("ro-mode"),
  roSize: el("ro-size"),
  roPeak: el("ro-peak"),
  roClipped: el("ro-clipped"),
  roHex: el("ro-hex"),
  roRgb: el("ro-rgb"),
  roDisplayClip: el("ro-display-clip"),
  footerMeta: el("footer-meta"),
};

function formatEv(stops) {
  const sign = stops > 0 ? "+" : stops < 0 ? "" : "+";
  return `${sign}${stops.toFixed(1)} EV`;
}

function updateReadout() {
  const m = state.metrics;
  if (!m) return;
  const [r, g, b] = m.highlight.byte;
  const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

  refs.peakLinear.textContent = `${m.peak.toFixed(2)}×`;
  refs.bufferClipped.textContent = `${m.bufferClipped.toLocaleString("en-US")} px`;
  refs.evReadout.textContent = formatEv(state.evStops);
  refs.evSlider.value = String(state.evStops);

  refs.roMode.textContent = state.mode === "sdr" ? "SDR preview" : "HDR / PQ preview";
  refs.roSize.textContent = `${m.cssWidth} × ${m.cssHeight}`;
  refs.roPeak.textContent = `${m.peak.toFixed(2)}×`;
  refs.roClipped.textContent = m.bufferClipped.toLocaleString("en-US");
  refs.roHex.textContent = hex;
  refs.roRgb.textContent =
    `RGB ${r}, ${g}, ${b}, 255 · ${m.highlight.nits.toFixed(1)} nit`;
  refs.roDisplayClip.textContent = m.displayClip.toLocaleString("en-US");

  refs.curveLabel.textContent =
    state.mode === "sdr"
      ? "Linear Rec.709 — ACES → sRGB"
      : "Linear Rec.709 — PQ ST.2084 / 1000 nit";

  refs.footerMeta.textContent =
    `Rec.709 · D65 · ${formatEv(state.evStops)} shared · shadow ${m.shadow.nits.toFixed(2)} nit`;

  refs.modeButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.mode === state.mode);
  });
}

function requestRender() {
  needsRender = true;
}

function setMode(mode) {
  if (mode !== "sdr" && mode !== "hdr") return;
  if (state.mode === mode) return;
  state.mode = mode;
  // exposure (EV) is intentionally not reset: same color baseline across previews
  requestRender();
}

function setEv(stops) {
  state.evStops = Math.min(3, Math.max(-3, Number(stops)));
  requestRender();
}

refs.modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});
refs.evSlider.addEventListener("input", (event) => setEv(event.target.value));
refs.resetEv.addEventListener("click", () => setEv(0));

window.addEventListener("keydown", (event) => {
  if (event.key === "1") setMode("sdr");
  if (event.key === "2") setMode("hdr");
});

let resizeDebounce = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(requestRender, 60);
});

window.__hdrLab.setMode = setMode;
window.__hdrLab.setEv = setEv;
window.__hdrLab.requestRender = requestRender;
window.__hdrLab.sampleAt = (x, y) => {
  const floatPixels = readFloatBuffer();
  const linear = probeAverage(floatPixels, renderWidth, renderHeight, { x, y });
  const display = displayValueFromLinear(linear);
  return { linear, display };
};

cacheUniforms();
rafHandle = requestAnimationFrame(frame);
window.__hdrLab.ready = true;
