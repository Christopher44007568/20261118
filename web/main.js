// 浏览器端：实例化 WASM 软件光栅器，并用同一组网格/MVP/纹理在 WebGL2 中
// 渲染对照结果，逐帧比较颜色与深度，监控 WASM 内存增长。
"use strict";

const W = 640, H = 480;
const FRAMES = 600;          // 总帧数（内存增长监控）
const COMPARE_EVERY = 10;    // 每隔多少帧做一次颜色/深度比较
const SHOWCASE_FRAME = 116;  // 展示帧：四边形正在被近裁剪面裁剪

const statusEl = document.getElementById("status");
function log(msg) { statusEl.textContent += msg + "\n"; }

async function loadWasm() {
  const resp = await fetch("soft_raster.wasm");
  const bytes = await resp.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports;
}

// ---------------------------------------------------------------------------
// WebGL2 对照渲染器
// ---------------------------------------------------------------------------

const SCENE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
layout(location=2) in vec2 aUV;
uniform mat4 uMVP;
out vec3 vColor;
out vec2 vUV;
void main() {
  vColor = aColor;
  vUV = aUV;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 oColor;
void main() {
  oColor = vec4(texture(uTex, vUV).rgb * vColor, 1.0);
}`;

// 把深度纹理可视化为灰度（同时用于深度 readback）。
const DEPTH_VS = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.))[gl_VertexID];
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0., 1.);
}`;

const DEPTH_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uDepth;
out vec4 oColor;
void main() {
  float d = texture(uDepth, vUV).r;
  oColor = vec4(d, d, d, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error("shader: " + gl.getShaderInfoLog(s));
  }
  return s;
}

function link(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("link: " + gl.getProgramInfoLog(p));
  }
  return p;
}

function createGl() {
  const canvas = document.getElementById("glCanvas");
  const gl = canvas.getContext("webgl2", {
    antialias: false, depth: false, alpha: false, preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("WebGL2 unavailable");

  // 场景 FBO：RGBA8 颜色 + DEPTH_COMPONENT24 深度纹理。
  const colorTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, colorTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const depthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, W, H, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const sceneFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("scene FBO incomplete");
  }

  // 深度 readback FBO（RGBA8，片元着色器输出灰度深度）。
  const depthVisTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, depthVisTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const depthFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, depthFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, depthVisTex, 0);

  const sceneProg = link(gl, SCENE_VS, SCENE_FS);
  const depthProg = link(gl, DEPTH_VS, DEPTH_FS);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { gl, canvas, colorTex, depthTex, sceneFbo, depthFbo, sceneProg, depthProg };
}

// ---------------------------------------------------------------------------
// 从 WASM 线性内存构建 GL 资源（保证两边使用同一组网格/纹理数据）
// ---------------------------------------------------------------------------

function buildMeshes(wasm, glc) {
  const { gl } = glc;
  const meshes = [];
  const count = wasm.mesh_count();
  for (let i = 0; i < count; i++) {
    const vCount = wasm.mesh_vertex_count(i);
    const iCount = wasm.mesh_index_count(i);
    const vPtr = wasm.mesh_vertices_ptr(i);
    const iPtr = wasm.mesh_indices_ptr(i);
    // 拷贝出来，避免 wasm 内存增长导致 view 失效（本程序不会增长，但保持健壮）。
    const verts = new Float32Array(wasm.memory.buffer, vPtr, vCount * 8).slice();
    const indices = new Uint32Array(wasm.memory.buffer, iPtr, iCount).slice();

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    meshes.push({ vao, count: iCount });
  }
  return meshes;
}

function buildTexture(wasm, glc) {
  const { gl } = glc;
  const size = wasm.texture_size();
  const ptr = wasm.texture_ptr();
  const texels = new Uint8Array(wasm.memory.buffer, ptr, size * size * 4).slice();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, texels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

// ---------------------------------------------------------------------------
// 渲染与 readback
// ---------------------------------------------------------------------------

function renderGl(wasm, glc, meshes, tex) {
  const { gl } = glc;
  gl.bindFramebuffer(gl.FRAMEBUFFER, glc.sceneFbo);
  gl.viewport(0, 0, W, H);
  gl.clearColor(15 / 255, 15 / 255, 23 / 255, 1.0);
  gl.clearDepth(1.0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.frontFace(gl.CCW);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(glc.sceneProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(gl.getUniformLocation(glc.sceneProg, "uTex"), 0);
  const mvpLoc = gl.getUniformLocation(glc.sceneProg, "uMVP");
  for (let i = 0; i < meshes.length; i++) {
    // 直接使用 WASM 刚算好的 MVP，保证两边变换完全一致。
    const mvp = new Float32Array(wasm.memory.buffer, wasm.mvp_ptr(i), 16);
    gl.uniformMatrix4fv(mvpLoc, false, mvp);
    gl.bindVertexArray(meshes[i].vao);
    gl.drawElements(gl.TRIANGLES, meshes[i].count, gl.UNSIGNED_INT, 0);
  }
  gl.bindVertexArray(null);

  // 颜色 readback
  const color = new Uint8Array(W * H * 4);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, glc.sceneFbo);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, color);

  // 深度 readback：把深度纹理画成灰度 RGBA8 再读
  gl.bindFramebuffer(gl.FRAMEBUFFER, glc.depthFbo);
  gl.viewport(0, 0, W, H);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(glc.depthProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, glc.depthTex);
  gl.uniform1i(gl.getUniformLocation(glc.depthProg, "uDepth"), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const depthVis = new Uint8Array(W * H * 4);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, glc.depthFbo);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, depthVis);

  // 显示到可见 canvas（默认帧缓冲，直接 blit 颜色）
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, glc.sceneFbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { color, depthVis };
}

// ---------------------------------------------------------------------------
// 比较与显示
// ---------------------------------------------------------------------------

const COLOR_TOL = 24;        // 单通道容差（栅格化边缘/舍入差异）
const COLOR_MISMATCH_BUDGET = 0.015; // 允许 1.5% 像素不一致
const DEPTH_TOL = 0.02;      // 深度容差（8bit readback 量化 + 24bit 深度）
const DEPTH_MISMATCH_BUDGET = 0.02;

function compareColor(wasmFb, glColor) {
  let mismatch = 0, sumAbs = 0, maxAbs = 0;
  const diff = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(wasmFb[i * 4 + c] - glColor[i * 4 + c]);
      sumAbs += d;
      if (d > worst) worst = d;
    }
    if (worst > maxAbs) maxAbs = worst;
    if (worst > COLOR_TOL) mismatch++;
    diff[i * 4] = Math.min(255, worst * 8);
    diff[i * 4 + 1] = Math.min(255, worst * 8);
    diff[i * 4 + 2] = Math.min(255, worst * 8);
    diff[i * 4 + 3] = 255;
  }
  return { mismatch, ratio: mismatch / (W * H), meanAbs: sumAbs / (W * H * 3), maxAbs, diff };
}

function compareDepth(wasmDepth, glDepthVis) {
  let compared = 0, mismatch = 0, maxAbs = 0;
  for (let i = 0; i < W * H; i++) {
    const wd = wasmDepth[i];
    const gd = glDepthVis[i * 4] / 255;
    if (wd >= 1.0 && gd >= 254 / 255) continue; // 双方都是背景
    compared++;
    const d = Math.abs(wd - gd);
    if (d > maxAbs) maxAbs = d;
    if (d > DEPTH_TOL) mismatch++;
  }
  return { compared, mismatch, ratio: compared ? mismatch / compared : 0, maxAbs };
}

function showPixels(canvasId, rgba, flipY) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const srcRow = flipY ? H - 1 - y : y;
    img.data.set(rgba.subarray(srcRow * W * 4, (srcRow + 1) * W * 4), y * W * 4);
  }
  ctx.putImageData(img, 0, 0);
}

function depthToGray(wasmDepth) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const g = Math.round(wasmDepth[i] * 255);
    out[i * 4] = g; out[i * 4 + 1] = g; out[i * 4 + 2] = g; out[i * 4 + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

(async function main() {
  statusEl.textContent = "";
  const wasm = await loadWasm();
  wasm.init(W, H);
  log(`WASM 加载完成: ${W}x${H}, 初始内存 ${wasm.memory.buffer.byteLength} 字节`);

  const glc = createGl();
  const meshes = buildMeshes(wasm, glc);
  const tex = buildTexture(wasm, glc);
  log(`网格: ${meshes.length} 个 (相交三角形 / 旋转立方体 / 穿越相机的四边形)`);

  const memSizes = new Set();
  let flippedTotal = 0;
  let clippedFrames = 0;
  let worstColor = { ratio: 0, meanAbs: 0, maxAbs: 0 };
  let worstDepth = { ratio: 0, maxAbs: 0 };
  let comparisons = 0;
  let showcase = null;

  for (let frame = 0; frame < FRAMES; frame++) {
    const t = frame / 60;
    wasm.render(t);
    memSizes.add(wasm.memory.buffer.byteLength);
    flippedTotal += wasm.stats_flipped_after_clip();
    if (wasm.stats_clipped_tris() > 0) clippedFrames++;

    const glOut = renderGl(wasm, glc, meshes, tex);

    if (frame % COMPARE_EVERY === 0 || frame === SHOWCASE_FRAME) {
      const fbPtr = wasm.framebuffer_ptr();
      const wasmFb = new Uint8Array(wasm.memory.buffer, fbPtr, W * H * 4);
      const wasmDepth = new Float32Array(wasm.memory.buffer, wasm.depth_ptr(), W * H);
      const cc = compareColor(wasmFb, glOut.color);
      const dc = compareDepth(wasmDepth, glOut.depthVis);
      comparisons++;
      if (cc.ratio > worstColor.ratio) worstColor = cc;
      if (dc.ratio > worstDepth.ratio) worstDepth = dc;
      if (frame === SHOWCASE_FRAME) {
        showcase = {
          wasmFb: wasmFb.slice(), wasmDepth: wasmDepth.slice(),
          glDepthVis: glOut.depthVis.slice(), diff: cc.diff,
        };
      }
    }
  }

  // 展示帧上屏（framebuffer 行序与 GL 一致，row 0 在底部，显示时翻转）
  if (showcase) {
    wasm.render(SHOWCASE_FRAME / 60);
    renderGl(wasm, glc, meshes, tex);
    showPixels("wasmColor", showcase.wasmFb, true);
    showPixels("wasmDepth", depthToGray(showcase.wasmDepth), true);
    showPixels("glDepth", showcase.glDepthVis, true);
    showPixels("diff", showcase.diff, true);
  }

  const memSizesArr = [...memSizes];
  const memStable = memSizes.size === 1;
  const colorPass = worstColor.ratio <= COLOR_MISMATCH_BUDGET;
  const depthPass = worstDepth.ratio <= DEPTH_MISMATCH_BUDGET;
  const flipPass = flippedTotal === 0;

  const results = {
    frames: FRAMES,
    comparisons,
    clippedFrames,
    flippedAfterClip: flippedTotal,
    memoryByteSizes: memSizesArr,
    memoryStable: memStable,
    color: { worstMismatchRatio: worstColor.ratio, worstMeanAbs: worstColor.meanAbs, worstMaxAbs: worstColor.maxAbs, tol: COLOR_TOL, budget: COLOR_MISMATCH_BUDGET, pass: colorPass },
    depth: { worstMismatchRatio: worstDepth.ratio, worstMaxAbs: worstDepth.maxAbs, tol: DEPTH_TOL, budget: DEPTH_MISMATCH_BUDGET, pass: depthPass },
    pass: memStable && colorPass && depthPass && flipPass,
  };
  window.__RESULTS = results;
  window.__DONE = true;

  log(`帧数: ${FRAMES} (比较 ${comparisons} 次), 发生近裁剪的帧: ${clippedFrames}`);
  log(`裁剪后翻转三角形: ${flippedTotal} -> ${flipPass ? "PASS" : "FAIL"}`);
  log(`WASM 内存: ${memSizesArr.join(", ")} 字节 -> ${memStable ? "PASS (不随帧数增长)" : "FAIL"}`);
  log(`颜色最差不一致率: ${(worstColor.ratio * 100).toFixed(3)}% (预算 ${COLOR_MISMATCH_BUDGET * 100}%) maxAbs=${worstColor.maxAbs} -> ${colorPass ? "PASS" : "FAIL"}`);
  log(`深度最差不一致率: ${(worstDepth.ratio * 100).toFixed(3)}% (预算 ${DEPTH_MISMATCH_BUDGET * 100}%) maxAbs=${worstDepth.maxAbs.toFixed(4)} -> ${depthPass ? "PASS" : "FAIL"}`);
  log(`总体: ${results.pass ? "PASS" : "FAIL"}`);
})().catch((e) => {
  window.__ERROR = String(e && e.stack || e);
  window.__DONE = true;
  log("ERROR: " + window.__ERROR);
});
