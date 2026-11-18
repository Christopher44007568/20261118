import { buildScene, makeCamera, cameraFrame, MAT } from "./scene.js";

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");

const state = {
  device: null,
  context: null,
  pipeline: null,
  buffers: {},
  width: 480,
  height: 270,
  frame: 0,
  paused: false,
  targetSpp: 1000,
  resetPending: true,
  autoSnap: true,
  snapped: new Set(),
  cam: makeCamera(),
  lastCamSig: null,
  fps: 0,
  fpsAccum: 0,
  fpsFrames: 0,
  running: false,
};

const BYTES = { V4: 16, V4U: 16 };

async function initGPU() {
  if (!navigator.gpu) throw new Error("当前浏览器不支持 WebGPU");
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("没有可用的 GPU 适配器");
  const device = await adapter.requestDevice();
  device.lost.then((info) => console.warn("GPU device lost:", info));
  device.addEventListener("uncapturederror", (e) => {
 console.error("WebGPU error:", e.error.message);
  });
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  state.device = device;
  state.context = context;
  state.format = format;
  state.adapterInfo = adapter.info || {};
}

function packSphere(s) {
  const d = new Float32Array(12);
  d.set(s.c, 0); d[3] = s.r;
  d.set(s.m.albedo, 4);
  d[8] = s.m.metallic; d[9] = s.m.roughness; d[10] = s.m.emission; d[11] = s.m.kind;
  return d;
}

function packBox(b) {
  const d = new Float32Array(16);
  d.set(b.min, 0);
  d.set(b.max, 4);
  d.set(b.m.albedo, 8);
  d[12] = b.m.metallic; d[13] = b.m.roughness; d[14] = b.m.emission; d[15] = b.m.kind;
  return d;
}

function packQuad(l) {
  // origin, edgeU(+halfW), edgeV(+halfH), normal(+area), emission
  const d = new Float32Array(20);
  d.set(l.origin, 0);
  d.set(l.edgeU, 4); d[7] = l.half[0];
  d.set(l.edgeV, 8); d[11] = l.half[1];
  d.set(l.normal, 12);
  const area = Math.hypot(...l.edgeU) * Math.hypot(...l.edgeV);
  d[15] = area;
  d[16] = l.color[0] * l.power;
  d[17] = l.color[1] * l.power;
  d[18] = l.color[2] * l.power;
  return d;
}

function makeStorage(device, data, label) {
  const buf = device.createBuffer({
    size: Math.max(16, data.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label,
  });
  if (data.byteLength) device.queue.writeBuffer(buf, 0, data);
  return buf;
}

function buildSceneBuffers(device) {
  const scene = buildScene();
  const sphereData = new Float32Array(scene.spheres.length * 12);
  scene.spheres.forEach((s, i) => sphereData.set(packSphere(s), i * 12));
  const boxData = new Float32Array(scene.boxes.length * 16);
  scene.boxes.forEach((b, i) => boxData.set(packBox(b), i * 16));
  const quadData = new Float32Array(scene.lights.length * 20);
  scene.lights.forEach((l, i) => quadData.set(packQuad(l), i * 20));
  return {
    spheres: makeStorage(device, sphereData, "spheres"),
    boxes: makeStorage(device, boxData, "boxes"),
    quads: makeStorage(device, quadData, "quads"),
    counts: { spheres: scene.spheres.length, boxes: scene.boxes.length, quads: scene.lights.length },
  };
}

function createFrameResources(device, width, height) {
  const pixels = width * height;
  const accum = device.createBuffer({
    size: pixels * BYTES.V4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    label: "accum",
  });
  const meta = device.createBuffer({
    size: pixels * BYTES.V4U,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    label: "meta",
  });
  const storageTex = device.createTexture({
    size: { width, height },
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
    label: "storage-tex",
  });
  const cameraU = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const paramsU = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  return { accum, meta, storageTex, cameraU, paramsU, pixels };
}

async function createPipeline(device) {
  const shader = await fetch("tracer.wgsl").then((r) => {
    if (!r.ok) throw new Error("无法加载 tracer.wgsl");
    return r.text();
  });
  const module = device.createShaderModule({ code: shader });
  const bindLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: "rgba8unorm" } },
    ],
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindLayout] }),
    compute: { module, entryPoint: "main" },
  });
  const blitModule = device.createShaderModule({
    code: `
      struct VsOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };
      @vertex fn vs(@builtin(vertex_index) i : u32) -> VsOut {
        var p = array<vec2f, 3>(
          vec2f(-1.0, -1.0), vec2f(-1.0, 3.0), vec2f(3.0, -1.0));
        var out : VsOut;
        out.pos = vec4f(p[i], 0.0, 1.0);
        out.uv = vec2f((p[i].x + 1.0) * 0.5, (p[i].y + 1.0) * 0.5);
        return out;
      }
      @group(0) @binding(0) var src : texture_2d<f32>;
      @group(0) @binding(1) var samp : sampler;
      @fragment fn fs(in : VsOut) -> @location(0) vec4f {
        return textureSample(src, samp, in.uv);
      }`,
  });
  const blitLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });
  const blitPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [blitLayout] }),
    vertex: { module: blitModule, entryPoint: "vs" },
    fragment: { module: blitModule, entryPoint: "fs", targets: [{ format: state.format }] },
    primitive: { topology: "triangle-list" },
  });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  return { pipeline, bindLayout, blitPipeline, blitLayout, sampler };
}

function buildBindGroup(device, layout, scene, frame) {
  return device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: frame.cameraU } },
      { binding: 1, resource: { buffer: frame.paramsU } },
      { binding: 2, resource: { buffer: scene.spheres } },
      { binding: 3, resource: { buffer: scene.boxes } },
      { binding: 4, resource: { buffer: scene.quads } },
      { binding: 5, resource: { buffer: frame.accum } },
      { binding: 6, resource: { buffer: frame.meta } },
      { binding: 7, resource: frame.storageTex.createView() },
    ],
  });
}

function buildBlitBindGroup(device, frame) {
  return device.createBindGroup({
    layout: state.blitLayout,
    entries: [
      { binding: 0, resource: frame.storageTex.createView() },
      { binding: 1, resource: state.sampler },
    ],
  });
}

function cameraSignature(cam) {
  return [cam.yaw, cam.pitch, cam.distance, ...cam.target].map((v) => v.toFixed(5)).join("|");
}

function writeUniforms(device, frame) {
  const { origin, topLeft, right, down } = cameraFrame(state.cam, state.width, state.height);
  const camData = new Float32Array(32);
  camData.set(origin, 0);
  camData.set(topLeft, 4);
  camData.set(right, 8);
  camData.set(down, 12);
  device.queue.writeBuffer(frame.cameraU, 0, camData);

  const p = new ArrayBuffer(32);
  const u32 = new Uint32Array(p);
  const f32 = new Float32Array(p);
  u32[0] = state.width;
  u32[1] = state.height;
  u32[2] = state.frame;
  u32[3] = state.resetPending ? 1 : 0;
  f32[4] = state.targetSpp;
  device.queue.writeBuffer(frame.paramsU, 0, p);
}

function renderFrame() {
  const device = state.device;
  const frame = state.frameRes;
  const sig = cameraSignature(state.cam);
  if (sig !== state.lastCamSig) {
    state.resetPending = true;
    state.frame = 0;
    state.snapped.clear();
    state.lastCamSig = sig;
  }

  writeUniforms(device, frame);
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(state.pipeline);
  pass.setBindGroup(0, state.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(state.width / 8), Math.ceil(state.height / 8));
  pass.end();

  // Blit the rgba8 compute texture into the (possibly bgra8) swapchain.
  const swap = state.context.getCurrentTexture();
  const rpass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: swap.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  rpass.setPipeline(state.blitPipeline);
  rpass.setBindGroup(0, frame.blitGroup);
  rpass.draw(3, 1, 0, 0);
  rpass.end();
  device.queue.submit([encoder.finish()]);

  state.resetPending = false;
  state.frame += 1;
  updateHud();
  maybeAutoSnapshot();
  if (state.frameHooks && state.frameHooks.length) {
    const due = state.frameHooks.filter((h) => h.at === state.frame);
    state.frameHooks = state.frameHooks.filter((h) => h.at !== state.frame);
    for (const h of due) h.resolve(state.frame);
  }
  if (state.haltAfterFrame === state.frame) {
    state.paused = true;
    state.haltAfterFrame = -1;
    $("btn-pause").textContent = "继续";
    updateHud();
  }
}

function waitForFrame(at) {
  state.frameHooks = state.frameHooks || [];
  if (state.frame >= at) return Promise.resolve(state.frame);
  state.haltAfterFrame = at;
  return new Promise((resolve) => state.frameHooks.push({ at, resolve }));
}

function loop(ts) {
  if (!state.running) return;
  if (!state.lastTs) state.lastTs = ts;
  const dt = ts - state.lastTs;
  state.lastTs = ts;
  state.fpsAccum += dt;
  state.fpsFrames += 1;
  if (state.fpsAccum >= 500) {
    state.fps = Math.round((state.fpsFrames * 1000) / state.fpsAccum);
    state.fpsAccum = 0;
    state.fpsFrames = 0;
  }
  if (!state.paused && state.frame < state.targetSpp) {
    renderFrame();
  } else if (state.frame >= state.targetSpp && !state.paused) {
    state.paused = true;
    $("btn-pause").textContent = "继续";
    $("status-text").textContent = "已达目标 SPP";
    $("hud-state").textContent = "已暂停";
  }
  requestAnimationFrame(loop);
}

function updateHud() {
  $("cur-spp").textContent = `${state.frame} SPP`;
  $("frame-count").textContent = state.frame;
  $("hud-spp").textContent = `${state.frame} SPP`;
  $("hud-fps").textContent = `${state.fps} fps`;
  $("hud-state").textContent = state.paused ? "已暂停" : "运行中";
  $("status-text").textContent = state.paused ? "已暂停" : "运行中";
}

// Read back the per-pixel sample count actually stored by the GPU.
async function readGpuSpp() {
  const device = state.device;
  const { meta, pixels } = state.frameRes;
  await device.queue.onSubmittedWorkDone();
  const staging = device.createBuffer({
    size: pixels * BYTES.V4U,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(meta, 0, staging, 0, staging.size);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const view = new Uint32Array(staging.getMappedRange());
  let min = Infinity;
  let max = 0;
  let sum = 0;
  let mismatch = 0;
  for (let i = 0; i < pixels; i++) {
    const n = view[i * 4 + 2];
    if (n < min) min = n;
    if (n > max) max = n;
    sum += n;
    if (n !== view[2]) mismatch++;
  }
  staging.unmap();
  staging.destroy();
  return { min, max, avg: sum / pixels, pixels, mismatch };
}

async function captureSnapshot(labelSpp) {
  const device = state.device;
  const { storageTex } = state.frameRes;
  const w = state.width;
  const h = state.height;
  await device.queue.onSubmittedWorkDone();
  // The WebGPU swapchain canvas is not a drawImage source; copy the
  // compute storage texture into a staging buffer and build an ImageBitmap.
  const alignedRow = Math.ceil((w * 4) / 256) * 256;
  const staging = device.createBuffer({
    size: alignedRow * h,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer(
    { texture: storageTex },
    { buffer: staging, bytesPerRow: alignedRow, rowsPerImage: h },
    { width: w, height: h }
  );
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  // Tighten rows (drop per-row alignment padding).
  const tight = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    tight.set(mapped.subarray(y * alignedRow, y * alignedRow + w * 4), y * w * 4);
  }
  const data = new ImageData(new Uint8ClampedArray(tight), w, h);
  const bitmap = await createImageBitmap(data);
  const snapCanvas = document.createElement("canvas");
  snapCanvas.width = w;
  snapCanvas.height = h;
  const ctx = snapCanvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const figure = document.querySelector(`.snap[data-spp="${labelSpp}"]`);
  figure.innerHTML = "";
  const img = document.createElement("img");
  img.src = snapCanvas.toDataURL("image/png");
  img.alt = `收敛图 @ ${labelSpp} SPP`;
  const cap = document.createElement("figcaption");
  cap.innerHTML = `<span>收敛图 @ ${state.frame} SPP</span><a class="dl">下载 PNG</a>`;
  cap.querySelector(".dl").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = img.src;
    a.download = `convergence-${labelSpp}spp.png`;
    a.click();
  });
  figure.append(img, cap);
  figure.dataset.canvas = "1";
  figure._canvas = snapCanvas;
}

function maybeAutoSnapshot() {
  if (!state.autoSnap) return;
  for (const spp of [10, 100, 1000]) {
    if (state.frame >= spp && !state.snapped.has(spp)) {
      state.snapped.add(spp);
      captureSnapshot(spp);
    }
  }
}

function setPaused(paused) {
  state.paused = paused;
  $("btn-pause").textContent = paused ? "继续" : "暂停";
  updateHud();
}

function requestReset({ clearSnapshots = true } = {}) {
  state.resetPending = true;
  state.frame = 0;
  if (clearSnapshots) {
    state.snapped.clear();
    document.querySelectorAll(".snap").forEach((f) => {
      const spp = f.dataset.spp;
      f.innerHTML = `<figcaption>等待采样… @ ${spp} SPP</figcaption><div class="snap-empty">${spp} SPP</div>`;
    });
  }
}

function resizeRendering(w, h) {
  state.width = w;
  state.height = h;
  canvas.width = w;
  canvas.height = h;
  state.frameRes.accum.destroy();
  state.frameRes.meta.destroy();
  state.frameRes.storageTex.destroy();
  state.frameRes.cameraU.destroy();
  state.frameRes.paramsU.destroy();
  const frame = createFrameResources(state.device, w, h);
  state.frameRes = frame;
  state.bindGroup = buildBindGroup(state.device, state.bindLayout, state.scene, frame);
  frame.blitGroup = buildBlitBindGroup(state.device, frame);
  requestReset();
}

function attachCameraControls() {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    state.cam.yaw -= dx * 0.006;
    state.cam.pitch = Math.max(-0.9, Math.min(1.1, state.cam.pitch + dy * 0.006));
  });
  const end = (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      state.cam.distance = Math.max(2.5, Math.min(12, state.cam.distance + e.deltaY * 0.005));
    },
    { passive: false }
  );
}

function log(msg, cls = "") {
  const box = $("selftest-log");
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  if (box.textContent.startsWith("尚未")) box.textContent = "";
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runSelfTest() {
  if (state.selftesting) return;
  state.selftesting = true;
  log("开始自检…", "warn");
  const checks = [];
  try {
    // 1. Deterministic reset: same pixel, two resets -> identical frame-1 value.
    requestReset({ clearSnapshots: false });
    state.targetSpp = 5;
    setPaused(false);
    await sleep(150);
    const first = await readPixelAccum();
    requestReset({ clearSnapshots: false });
    await sleep(150);
    const second = await readPixelAccum();
    const deterministic =
      first.length === second.length &&
      first.every((v, i) => Math.abs(v - second[i]) < 1e-6);
    checks.push([`重置后可复现（两次首帧像素一致）: ${deterministic}`, deterministic]);

    // 2. Pause / resume keeps increasing the GPU sample counter.
    state.targetSpp = 100000;
    requestReset({ clearSnapshots: false });
    setPaused(false);
    await sleep(120);
    setPaused(true);
    const before = await readGpuSpp();
    log(`暂停时 GPU 样本数 = ${before.max}`);
    await sleep(200);
    const during = await readGpuSpp();
    const frozen = before.max === during.max;
    setPaused(false);
    await sleep(250);
    const after = await readGpuSpp();
    log(`恢复后 GPU 样本数 = ${after.max}（暂停期间 ${during.max}）`);
    checks.push([`暂停时样本冻结: ${frozen}`, frozen]);
    checks.push([`恢复后样本继续增长: ${after.max > before.max}`, after.max > before.max]);
    setPaused(true);

    // 3. All pixels share a consistent sample count.
    checks.push([
      `全部像素样本数一致（min=${after.min}, max=${after.max}, 异常=${after.mismatch}）`,
      after.min === after.max && after.mismatch === 0,
    ]);

    // 4. Scene contains the required primitives.
    const okScene =
      state.scene.counts.spheres >= 3 &&
      state.scene.counts.boxes >= 1 &&
      state.scene.counts.quads >= 1;
    checks.push([
      `场景图元齐全（球 ${state.scene.counts.spheres}/盒 ${state.scene.counts.boxes}/面光 ${state.scene.counts.quads}）`,
      okScene,
    ]);
  } catch (err) {
    log(`自检异常: ${err.message}`, "err");
    console.error(err);
  }
  for (const [msg, ok] of checks) log(`${ok ? "PASS" : "FAIL"} · ${msg}`, ok ? "ok" : "err");
  log(checks.every(([, ok]) => ok) ? "自检全部通过 ✔" : "自检存在失败项 ✘", checks.every(([, ok]) => ok) ? "ok" : "err");
  state.selftesting = false;
}

async function readPixelAccum() {
  const device = state.device;
  const { accum } = state.frameRes;
  const staging = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(accum, 0, staging, 0, 16);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const out = Array.from(new Float32Array(staging.getMappedRange().slice(0)));
  staging.unmap();
  staging.destroy();
  return out;
}

async function bounceTest() {
  // Explicit pause → sample N → resume → verify monotonic growth.
  const result = [];
  state.targetSpp = 100000;
  setPaused(true);
  requestReset({ clearSnapshots: false });
  setPaused(false);
  await sleep(150);
  setPaused(true);
  const a = await readGpuSpp();
  result.push(`阶段 A 暂停于 ${a.max} SPP`);
  setPaused(false);
  await sleep(300);
  setPaused(true);
  const b = await readGpuSpp();
  result.push(`阶段 B 再暂停于 ${b.max} SPP`);
  result.push(b.max > a.max ? "PASS · 样本数在暂停/继续后持续增加" : "FAIL · 样本数未增长");
  result.forEach((m) => log(m, m.startsWith("PASS") ? "ok" : m.startsWith("FAIL") ? "err" : "warn"));
}

async function main() {
  try {
    await initGPU();
    const pipe = await createPipeline(state.device);
    state.pipeline = pipe.pipeline;
    state.bindLayout = pipe.bindLayout;
    state.blitPipeline = pipe.blitPipeline;
    state.blitLayout = pipe.blitLayout;
    state.sampler = pipe.sampler;
    state.scene = buildSceneBuffers(state.device);
    state.frameRes = createFrameResources(state.device, state.width, state.height);
    state.bindGroup = buildBindGroup(state.device, state.bindLayout, state.scene, state.frameRes);
    state.frameRes.blitGroup = buildBlitBindGroup(state.device, state.frameRes);
    const info = state.adapterInfo;
    $("gpu-badge").textContent = `WebGPU · ${info.device || info.description || "GPU 就绪"}`;
    $("gpu-badge").classList.add("ok");

    attachCameraControls();
    $("btn-reset").addEventListener("click", () => { state.targetSpp = Number($("target-spp").value); requestReset(); setPaused(false); });
    $("btn-pause").addEventListener("click", () => setPaused(!state.paused));
    $("btn-snapshot").addEventListener("click", () => captureSnapshot(state.frame));
    $("btn-selftest").addEventListener("click", runSelfTest);
    $("btn-cam-reset").addEventListener("click", () => { state.cam = makeCamera(); });
    $("btn-bounce-test").addEventListener("click", bounceTest);
    $("target-spp").addEventListener("change", (e) => { state.targetSpp = Number(e.target.value); setPaused(false); });
    $("auto-snap").addEventListener("change", (e) => { state.autoSnap = e.target.checked; });
    $("res-select").addEventListener("change", (e) => {
      const [w, h] = e.target.value.split("x").map(Number);
      resizeRendering(w, h);
    });

    state.running = true;
    state.lastCamSig = cameraSignature(state.cam);
    requestAnimationFrame(loop);

    // Debug / automation handles (used by the e2e test).
    window.__state = state;
    window.readGpuSpp = readGpuSpp;
    window.requestReset = requestReset;
    window.captureSnapshot = captureSnapshot;
    window.waitForFrame = waitForFrame;

    // Periodic GPU-side sample readback for the HUD.
    setInterval(async () => {
      if (state.paused || state.selftesting) return;
      const g = await readGpuSpp();
      $("gpu-spp").textContent = `${g.max}（min ${g.min}）`;
    }, 1000);
  } catch (err) {
    $("gpu-badge").textContent = `WebGPU 不可用: ${err.message}`;
    $("gpu-badge").classList.add("err");
    console.error(err);
  }
}

main();
