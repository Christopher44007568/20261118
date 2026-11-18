// 测试驱动：脚本化鼠标移动、遮挡/背景/裁剪边缘采样、resize、DPR 变更、删除对象
// 结果写入 window.__TEST_RESULT__，由 e2e 通过 CDP 收集

import { transformPoint } from './math.js';

export async function runTest(state) {
  while (!state.ready) await sleep(50);
  const { scene, camera, canvas, picker } = state;
  const phases = {};
  const dprSeen = [window.devicePixelRatio];

  const sleepFrames = (n) =>
    new Promise((resolve) => {
      const target = state.frames + n;
      const tick = () => (state.frames >= target ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });

  function projectToCss(world) {
    const { viewProj } = camera.matrices(canvas.width / canvas.height);
    const ndc = transformPoint(viewProj, world);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((ndc[0] + 1) / 2) * rect.width,
      y: rect.top + ((1 - ndc[1]) / 2) * rect.height,
    };
  }

  function instCenter(objIndex, instIndex) {
    const m = scene.objects[objIndex].instances[instIndex].model;
    return [m[12], m[13], m[14]];
  }

  async function pickAt(cssX, cssY, settleFrames = 3) {
    state.mouse.cssX = cssX;
    state.mouse.cssY = cssY;
    state.mouse.inside = true;
    state.mouse.dirty = true;
    await sleepFrames(settleFrames);
  }

  async function pickWorld(world, settleFrames = 3) {
    const p = projectToCss(world);
    await pickAt(p.x, p.y, settleFrames);
  }

  // 阶段 1：相互遮挡的实例 —— 逐实例中心与重叠区采样
  for (let i = 0; i < 3; i++) {
    await pickWorld(instCenter(0, i));
    await pickWorld(offset(instCenter(0, i), 0.25, 0.2));
  }
  phases.occlusion = { mismatches: picker.stats.mismatches, hits: picker.stats.validHits };

  // 阶段 2：背景空白 —— 四角与顶部
  const rect0 = canvas.getBoundingClientRect();
  for (const [fx, fy] of [[0.03, 0.05], [0.97, 0.05], [0.03, 0.95], [0.97, 0.95], [0.5, 0.03]]) {
    await pickAt(rect0.left + rect0.width * fx, rect0.top + rect0.height * fy);
  }
  phases.background = { mismatches: picker.stats.mismatches, bg: picker.stats.backgroundHits };

  // 阶段 3：裁剪边缘 —— 左侧半可见实例，沿画布左缘采样
  const edgeCenter = instCenter(1, 0);
  await pickWorld(edgeCenter);
  const edgeCss = projectToCss(edgeCenter);
  const rect1 = canvas.getBoundingClientRect();
  for (let dx = 2; dx <= 14; dx += 4) {
    await pickAt(rect1.left + dx, edgeCss.y, 2);
  }
  phases.clipEdge = { mismatches: picker.stats.mismatches };

  // 阶段 4：改变画布 CSS 尺寸（模拟窗口尺寸变化），随后重新校验命中
  canvas.style.width = '62%';
  canvas.style.height = '70%';
  await sleepFrames(5);
  for (let i = 0; i < 3; i++) await pickWorld(instCenter(0, i));
  phases.resize = { resizes: state.resizes, mismatches: picker.stats.mismatches };

  // 阶段 5：等待 e2e 通过 CDP 改变 DPR / 视口，再校验换算仍然正确
  window.__TEST_PHASE__ = 'await-dpr';
  const dprBefore = window.devicePixelRatio;
  const deadline = Date.now() + 15000;
  while (window.devicePixelRatio === dprBefore && Date.now() < deadline) await sleep(100);
  dprSeen.push(window.devicePixelRatio);
  await sleepFrames(5);
  for (let i = 0; i < 3; i++) await pickWorld(instCenter(0, i));
  await pickWorld(instCenter(1, 1));
  phases.dpr = {
    changed: window.devicePixelRatio !== dprBefore,
    dpr: window.devicePixelRatio,
    mismatches: picker.stats.mismatches,
  };

  // 阶段 5b：回读可见画面像素 —— 物体处应为暖色（红/黄高亮），背景应为暗色
  async function capturePixel(key, world) {
    const { viewProj } = camera.matrices(canvas.width / canvas.height);
    const ndc = transformPoint(viewProj, world);
    const px = Math.min(canvas.width - 1, Math.max(0, Math.floor(((ndc[0] + 1) / 2) * canvas.width)));
    const py = Math.min(canvas.height - 1, Math.max(0, Math.floor(((1 - ndc[1]) / 2) * canvas.height)));
    state.captureRequest = { key, px, py };
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      await sleep(50);
      if (state.lastCapture && state.lastCapture.key === key) return state.lastCapture.rgba;
    }
    return null;
  }
  const objPixel = await capturePixel('obj', instCenter(0, 0));
  const bgPixel = await capturePixel('bg', [0, 8, -30]);
  const visibleOk =
    !!objPixel && !!bgPixel &&
    objPixel[0] > objPixel[2] + 20 &&
    Math.max(...bgPixel.slice(0, 3)) < 90;
  phases.visible = { objPixel, bgPixel, visibleOk };

  // 阶段 6：选中 victim 后删除，在途旧结果必须被丢弃且不得恢复选中
  const victim = scene.objects[2];
  await pickWorld(instCenter(2, 0), 6);
  const selectedBeforeDelete = state.selection ? { ...state.selection } : null;
  const wiggle = setInterval(() => {
    const p = projectToCss(instCenter(2, 0));
    state.mouse.cssX = p.x + Math.random() * 6 - 3;
    state.mouse.cssY = p.y + Math.random() * 6 - 3;
    state.mouse.inside = true;
    state.mouse.dirty = true;
  }, 16);
  // 让删除发生在拾取请求提交之后、回读解析之前，制造携带旧版本的在途请求
  state.deleteAfterSubmit = victim.id;
  await sleepFrames(12);
  clearInterval(wiggle);
  const selectionAfterDelete = state.selection ? { ...state.selection } : null;
  phases.delete = {
    deletedId: victim.id,
    selectedBeforeDelete,
    selectionAfterDelete,
    discarded: picker.stats.discarded,
    staleViolation: state.staleViolation,
  };

  // 收尾：停止移动，等待在途映射全部完成，验证缓冲全部归还
  state.mouse.inside = false;
  await sleepFrames(5);
  await sleep(400);

  const s = picker.stats;
  const pass =
    s.mismatches === 0 &&
    s.validHits > 0 &&
    s.backgroundHits > 0 &&
    s.discarded > 0 &&
    !state.staleViolation &&
    (!selectionAfterDelete || selectionAfterDelete.objectId !== victim.id) &&
    picker.inFlight === 0 &&
    s.poolReused > 0 &&
    state.resizes >= 1 &&
    phases.dpr.changed &&
    phases.visible.visibleOk;

  window.__TEST_RESULT__ = {
    pass,
    frames: state.frames,
    stats: { ...s, avgLatencyMs: s.resolved ? s.totalLatencyMs / s.resolved : 0 },
    mismatchLog: picker.mismatchLog,
    phases,
    dprSeen,
    resizes: state.resizes,
    inFlightEnd: picker.inFlight,
  };
  document.body.dataset.testDone = 'true';
}

function offset(p, dx, dy) {
  return [p[0] + dx, p[1] + dy, p[2]];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
