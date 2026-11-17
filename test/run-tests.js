import assert from 'node:assert/strict';
import { createMockGL } from './webgl-mock.js';
import { MsaaTarget } from '../js/msaa.js';
import { estimateMemory } from '../js/stats.js';
import { querySampleSupport, fboStatusString } from '../js/glutil.js';
import { analyzeFrame, coverageAt } from '../js/inspector.js';
import { DepthGuard, createDepthTestProgram } from '../js/depthtest.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name);
    console.error('    ' + err.message);
    process.exitCode = 1;
  }
}

console.log('MSAA 渲染目标结构');

test('1x 模式：单个 FBO，颜色纹理 + 深度 renderbuffer，无 blit', () => {
  const gl = createMockGL();
  const target = new MsaaTarget(gl, 320, 240, 1);
  assert.equal(target.samples, 1);
  assert.equal(target.geometryFbo, target.resolveFbo);
  assert.equal(target.msFbo, null);
  target.resolve(gl);
  assert.ok(!gl._calls.some((c) => c[0] === 'blitFramebuffer'));
  assert.equal(target.resolveStatus, gl.FRAMEBUFFER_COMPLETE);
  target.destroy(gl);
});

test('4x 模式：独立多重采样 FBO 与 resolve FBO，resolve 走 blit', () => {
  const gl = createMockGL();
  const target = new MsaaTarget(gl, 320, 240, 4);
  assert.notEqual(target.geometryFbo, target.resolveFbo);
  assert.ok(target.colorRb && target.depthRb);
  const storageCalls = gl._calls.filter(
    (c) => c[0] === 'renderbufferStorageMultisample'
  );
  assert.equal(storageCalls.length, 2);
  assert.ok(storageCalls.every((c) => c[1] === 4));
  target.resolve(gl);
  const blit = gl._calls.filter((c) => c[0] === 'blitFramebuffer');
  assert.equal(blit.length, 1);
  assert.equal(blit[0][1], gl.COLOR_BUFFER_BIT);
  assert.equal(blit[0][2], gl.NEAREST);
  target.destroy(gl);
});

test('resolve FBO 没有深度附件（深度不随纹理泄漏）', () => {
  const gl = createMockGL();
  const target = new MsaaTarget(gl, 64, 64, 4);
  assert.equal(target.resolveFboHasDepth(gl), false);
  const guard = new DepthGuard(gl, { log() {} });
  const checks = guard.structuralChecks(target);
  assert.equal(checks.depthLeakRisk, false);
  assert.equal(checks.fboOk, true);
  const resolveAtt = gl._attachments.get(target.resolveFbo);
  assert.ok(resolveAtt[gl.COLOR_ATTACHMENT0]);
  assert.equal(resolveAtt[gl.DEPTH_ATTACHMENT], undefined);
  const geoAtt = gl._attachments.get(target.msFbo);
  assert.ok(geoAtt[gl.DEPTH_ATTACHMENT]);
});

test('resolve 后帧缓冲绑定恢复为 null', () => {
  const gl = createMockGL();
  const target = new MsaaTarget(gl, 64, 64, 2);
  target.resolve(gl);
  const tail = gl._calls.slice(-2);
  assert.deepEqual(tail.map((c) => c[2]), [null, null]);
});

test('destroy 释放全部 GL 资源', () => {
  const gl = createMockGL();
  const target = new MsaaTarget(gl, 64, 64, 4);
  const fboCount = gl._framebuffers.size;
  assert.equal(fboCount, 2);
  target.destroy(gl);
  assert.equal(gl._framebuffers.size, 0);
});

console.log('显存估算');

test('估算随采样数线性增长，1x 纹理被重复计算为直渲颜色', () => {
  const m1 = estimateMemory(1000, 1000, 1);
  const m2 = estimateMemory(1000, 1000, 2);
  const m4 = estimateMemory(1000, 1000, 4);
  assert.equal(m1.colorTextureBytes, 4_000_000);
  assert.equal(m1.msDepthBytes, 3_000_000);
  assert.equal(m2.msColorBytes, 8_000_000);
  assert.equal(m4.msColorBytes, 16_000_000);
  assert.equal(m4.msDepthBytes, 12_000_000);
  assert.ok(m4.totalBytes > m2.totalBytes && m2.totalBytes > m1.totalBytes);
});

console.log('采样能力查询与状态字符串');

test('querySampleSupport 映射设备采样列表', () => {
  const gl = createMockGL();
  const support = querySampleSupport(gl);
  assert.equal(support[2], 2);
  assert.equal(support[4], 4);
  assert.equal(support.max, 8);
  assert.match(fboStatusString(gl, gl.FRAMEBUFFER_COMPLETE), /COMPLETE/);
});

console.log('像素覆盖率与形状分析');

test('coverageAt 区分背景、前景与边缘混合', () => {
  // 构造 5x1：背景、25%/50%/75% 混合、纯前景
  const bg = [10, 14, 24], fg = [250, 77, 77];
  const mix25 = fg.map((v, i) => Math.round(v * 0.25 + bg[i] * 0.75));
  const mix50 = fg.map((v, i) => Math.round(v * 0.5 + bg[i] * 0.5));
  const mix75 = fg.map((v, i) => Math.round(v * 0.75 + bg[i] * 0.25));
  const pixels = new Uint8Array([
    ...bg, 255, ...mix25, 255, ...mix50, 255, ...mix75, 255, ...fg, 255,
  ]);
  const bgRes = coverageAt(pixels, 5, 0, 0);
  assert.equal(bgRes.isBackground, true);
  const edgeRes = coverageAt(pixels, 5, 2, 0);
  assert.equal(edgeRes.isEdge, true);
  assert.ok(Math.abs(edgeRes.coverage - 0.5) < 0.08);
  const fgRes = coverageAt(pixels, 5, 4, 0);
  assert.equal(fgRes.isEdge, false);
  assert.equal(fgRes.coverage, 1);
});

test('analyzeFrame 在 mock 图案上统计背景/前景', () => {
  const gl = createMockGL();
  gl.readPixels = (x, y, w, h, fmt, type, dest) => {
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        const fgPixel = px >= w / 2;
        dest[i] = fgPixel ? 250 : 10;
        dest[i + 1] = fgPixel ? 77 : 14;
        dest[i + 2] = fgPixel ? 77 : 24;
        dest[i + 3] = 255;
      }
    }
  };
  const target = new MsaaTarget(gl, 10, 4, 1);
  const stats = analyzeFrame(gl, target);
  assert.equal(stats.background + stats.foreground + stats.edge, 40);
  assert.equal(stats.background, 20);
  assert.equal(stats.foreground, 20);
  assert.equal(stats.mass, 20);
});

console.log('深度泄漏行为测试');

test('清除深度时近帧可见；不清除时被上一帧残留深度遮挡', () => {
  const gl = createMockGL();
  let storedDepth = 1;
  let pathClearsDepth = true;
  let frame2 = false;
  gl.clear = (mask) => {
    if (mask & gl.DEPTH_BUFFER_BIT) storedDepth = 1;
    gl._calls.push(['clear', mask]);
  };
  gl.uniform4f = () => {};
  gl.drawArrays = () => {
    const z = gl._nextDepth;
    const pass = z <= storedDepth;
    if (pass) storedDepth = z;
    gl._drawPass = pass;
  };
  gl.uniform1f = (loc, z) => { gl._nextDepth = z; };
  gl.readPixels = (x, y, w, h, fmt, type, dest) => {
    const pass = gl._drawPass !== false;
    // 真实驱动：失败的第二帧不写入颜色，缓冲停留在 clear 后的黑色。
    const color = pass ? [0, 255, 0, 255] : [0, 0, 0, 255];
    dest.set(color);
  };
  // runBehaviorTest 依次执行“正确路径”和“泄漏路径”，重置每条路径的深度状态。
  const originalClear = gl.clear.bind(gl);
  gl.clear = (mask) => {
    if (!(mask & gl.DEPTH_BUFFER_BIT)) frame2 = true;
    originalClear(mask);
  };
  const guard = new DepthGuard(gl, { log() {} });
  const programInfo = createDepthTestProgram(gl);
  const result = guard.runBehaviorTest(programInfo);
  assert.equal(result.correctVisible, true, '清除深度时绿色可见');
  assert.equal(result.leakedWrong, true, '残留深度导致错误遮挡');
  assert.equal(result.depthLeakRisk, undefined, '1x 目标不报告 resolve 深度风险');
});

console.log(`\n全部 ${passed} 项测试通过`);
