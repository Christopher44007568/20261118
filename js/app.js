import { initDevice, createCubeGeometry, createPipelines } from './gpu.js';
import { buildScene, updateInstances, CAMERAS } from './scene.js';
import { VisibilityEngine } from './culler.js';

const params = new URLSearchParams(location.search);
const TEST_MODE = params.has('test');
const TEST_FRAMES_PER_CAMERA = 40;
const TEST_TOTAL_FRAMES = TEST_FRAMES_PER_CAMERA * CAMERAS.length;

const state = {
  cameraIndex: 0,
  autoCycle: false,
  frame: 0,
  lastCpuMs: 0,
  lastFrameMs: 0,
  cameraStats: CAMERAS.map(() => ({ frames: 0, match: 0, mismatch: 0, pending: 0 })),
  finished: false,
};

const ui = {};

function bindUi() {
  ui.candidate = document.getElementById('cpu-candidates');
  ui.gpuVisible = document.getElementById('gpu-visible');
  ui.total = document.getElementById('total-instances');
  ui.frameMs = document.getElementById('frame-ms');
  ui.cpuMs = document.getElementById('cpu-ms');
  ui.match = document.getElementById('match-state');
  ui.detail = document.getElementById('match-detail');
  ui.camera = document.getElementById('camera-name');
  ui.report = document.getElementById('test-report');
  for (const btn of document.querySelectorAll('[data-camera]')) {
    btn.addEventListener('click', () => {
      state.cameraIndex = Number(btn.dataset.camera);
      state.autoCycle = false;
    });
  }
  document.getElementById('btn-auto').addEventListener('click', () => {
    state.autoCycle = !state.autoCycle;
  });
}

function setMatchBadge(consistency) {
  if (!consistency) {
    ui.match.textContent = '等待回读…';
    ui.match.className = 'badge pending';
    return;
  }
  if (consistency.match) {
    ui.match.textContent = `一致 ✓ (帧 ${consistency.frame})`;
    ui.match.className = 'badge ok';
  } else {
    ui.match.textContent = `不一致 ✗ (帧 ${consistency.frame})`;
    ui.match.className = 'badge bad';
  }
  ui.detail.textContent =
    `CPU 可见 ${consistency.cpuCount}，GPU 可见 ${consistency.gpuCount}` +
    (consistency.match ? '' : `，漏裁 ${JSON.stringify(consistency.missing)}，多裁 ${JSON.stringify(consistency.extra)}`);
}

function finishTest(engine) {
  state.finished = true;
  const lines = CAMERAS.map((cam, i) => {
    const s = state.cameraStats[i];
    return `相机${cam.name}: 比对 ${s.match + s.mismatch} 帧, 一致 ${s.match}, 不一致 ${s.mismatch}`;
  });
  const allOk = state.cameraStats.every((s) => s.mismatch === 0 && s.match > 0);
  const report = {
    ok: allOk,
    frames: state.frame,
    cameras: lines,
    lastConsistency: engine.lastConsistency,
  };
  ui.report.hidden = false;
  ui.report.textContent = JSON.stringify(report, null, 2);
  ui.report.className = allOk ? 'report ok' : 'report bad';
  document.body.dataset.testDone = allOk ? '1' : '0';
  window.__TEST_RESULT__ = report;
  console.log('[TEST]', report);
}

async function main() {
  bindUi();
  const canvas = document.getElementById('canvas');
  const { device, context, format } = await initDevice(canvas);
  device.addEventListener('uncapturederror', (event) => {
    console.error('[WebGPU]', event.error.message);
    window.__GPU_ERRORS__ = window.__GPU_ERRORS__ || [];
    window.__GPU_ERRORS__.push(event.error.message);
  });
  const cube = createCubeGeometry(device);
  const pipelines = await createPipelines(device, format);
  const instances = buildScene();
  const engine = new VisibilityEngine(device, pipelines, instances, cube);
  ui.total.textContent = String(instances.length);
  window.__engine = engine;

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  let lastTime = performance.now();

  function tick(now) {
    const frameStart = performance.now();
    const realDt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const dt = TEST_MODE ? 1 / 60 : realDt;

    if (TEST_MODE) {
      state.cameraIndex = Math.min(
        CAMERAS.length - 1,
        Math.floor(state.frame / TEST_FRAMES_PER_CAMERA)
      );
    } else if (state.autoCycle) {
      state.cameraIndex = Math.floor(now / 4000) % CAMERAS.length;
    }

    updateInstances(instances, dt);
    const camera = CAMERAS[state.cameraIndex];
    ui.camera.textContent = camera.name;

    const encoder = device.createCommandEncoder();
    const t0 = performance.now();
    const { candidateCount } = engine.frame(camera, canvas.width / canvas.height, encoder);
    const t1 = performance.now();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.07, g: 0.08, b: 0.11, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(pipelines.render);
    pass.setBindGroup(0, engine.renderBindGroup);
    pass.setVertexBuffer(0, cube.buffer);
    pass.drawIndirect(engine.indirectBuffer, 0);
    pass.end();

    device.queue.submit([encoder.finish()]);

    const consistency = engine.lastConsistency;
    const stat = state.cameraStats[state.cameraIndex];
    if (consistency && consistency.frame >= 0) {
      const belongs = Math.floor(consistency.frame / TEST_FRAMES_PER_CAMERA);
      if (TEST_MODE && belongs === state.cameraIndex && stat.frames <= TEST_FRAMES_PER_CAMERA) {
        stat.frames++;
        if (consistency.match) stat.match++; else stat.mismatch++;
      }
    }

    ui.candidate.textContent = String(candidateCount);
    ui.gpuVisible.textContent = consistency ? String(consistency.gpuCount) : '—';
    ui.frameMs.textContent = (performance.now() - frameStart).toFixed(2);
    ui.cpuMs.textContent = (t1 - t0).toFixed(2);
    setMatchBadge(consistency);

    if (TEST_MODE) {
      window.__CANDIDATE_SAMPLES__ = window.__CANDIDATE_SAMPLES__ || {};
      const key = camera.name;
      (window.__CANDIDATE_SAMPLES__[key] ||= []).push(candidateCount);
    }

    state.frame++;
    if (TEST_MODE) {
      if (state.frame >= TEST_TOTAL_FRAMES + 3 && !state.finished) {
        // 额外 3 帧等待最后一槽回读完成
        setTimeout(() => finishTest(engine), 200);
      }
      if (state.finished) return;
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('fatal');
  el.textContent = String(err);
  el.style.display = 'block';
});
