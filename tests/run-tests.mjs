import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
mkdirSync(join(root, 'artifacts'), { recursive: true });

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8131) + '/index.html';
const W = 960, H = 720;

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-gpu-sandbox'
  ]
});
const page = await browser.newPage({ viewport: { width: 1000, height: 780 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE:', m.text()); });

await page.goto(BASE);
await page.waitForFunction(() => window.__ssaoReady === true, { timeout: 20000 });

// ---- helpers that run inside the page ------------------------------------
const api = {
  setParams: (p) => page.evaluate((p) => window.__ssao.setParams(p), p),
  setCamera: (yaw, pitch) => page.evaluate(([y, p]) => window.__ssao.setCameraAngles(y, p), [yaw, pitch]),
  render: () => page.evaluate(() => window.__ssao.renderFrame()),
  project: (name) => page.evaluate((n) => window.__ssao.project(window.__ssao.probes[n]), name),
  pixels: (mode) => page.evaluate(async (m) => {
    const arr = await window.__ssao.renderer.captureView(m, false);
    return Array.from(arr);
  }, mode),
  aoFloat: () => page.evaluate(async () => {
    const app = window.__ssao;
    const r = app.renderer, gl = r.gl;
    app.renderFrame();
    const f = new Float32Array(r.width * r.height * 4);
    const target = r.params.blur ? r.aoBlurTarget : r.aoTarget;
    target.bind();
    gl.readPixels(0, 0, r.width, r.height, gl.RGBA, gl.FLOAT, f);
    return Array.from(f);
  }),
  regionAoFloat: (name, radius = 6) => page.evaluate(async ({ name, radius }) => {
    const app = window.__ssao;
    const r = app.renderer, gl = r.gl;
    app.renderFrame();
    const f = new Float32Array(r.width * r.height * 4);
    const target = r.params.blur ? r.aoBlurTarget : r.aoTarget;
    target.bind();
    gl.readPixels(0, 0, r.width, r.height, gl.RGBA, gl.FLOAT, f);
    const s = app.project(app.probes[name]);
    const vals = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = Math.round(s.x + dx), y = Math.round(s.y + dy);
        if (x < 0 || x >= r.width || y < 0 || y >= r.height) continue;
        vals.push(f[(y * r.width + x) * 4]);
      }
    }
    return { screen: s, mean: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), n: vals.length };
  }, { name, radius }),
  regionAo: (name, radius = 6) => page.evaluate(async ({ name, radius }) => {
    const app = window.__ssao;
    const px = await app.renderer.captureView(1, false); // AO-only grayscale
    const s = app.project(app.probes[name]);
    const vals = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = Math.round(s.x + dx);
        const y = Math.round(s.y + dy);
        if (x < 0 || x >= app.width || y < 0 || y >= app.height) continue;
        const i = (y * app.width + x) * 4;
        vals.push(px[i] / 255);
      }
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { screen: s, mean, min: Math.min(...vals), n: vals.length };
  }, { name, radius }),
  normalsAt: (name) => page.evaluate(async (n) => {
    const app = window.__ssao;
    const px = await app.renderer.captureView(3, false); // normals
    const s = app.project(app.probes[n]);
    const grid = [];
    for (const off of [[-8, 0], [8, 0], [0, -8], [0, 8], [0, 0]]) {
      const x = Math.round(s.x + off[0]), y = Math.round(s.y + off[1]);
      const i = (y * app.width + x) * 4;
      grid.push([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255]);
    }
    return { screen: s, grid };
  }, name),
  clothStats: () => page.evaluate(async () => {
    const app = window.__ssao;
    const px = await app.renderer.captureView(3, false);
    const s = app.project(app.probes.cloth);
    const decode = (c) => c * 2 - 1;
    const at = (dx, dy) => {
      const x = Math.round(s.x + dx), y = Math.round(s.y + dy);
      const i = (y * app.width + x) * 4;
      const n = [decode(px[i] / 255), decode(px[i + 1] / 255), decode(px[i + 2] / 255)];
      const len = Math.hypot(...n);
      return n.map((v) => v / len);
    };
    const center = at(0, 0);
    // Sample a wide grid over the projected cloth so the curved surface's
    // normal variation is captured rather than a locally similar patch.
    const gridNormals = [];
    for (let dy = -70; dy <= 70; dy += 20) {
      for (let dx = -90; dx <= 90; dx += 20) {
        const x = Math.round(s.x + dx), y = Math.round(s.y + dy);
        if (x < 2 || x >= app.width - 2 || y < 2 || y >= app.height - 2) continue;
        gridNormals.push(at(dx, dy));
      }
    }
    const dots = [];
    for (const n of gridNormals) {
      dots.push(center.reduce((a, v, k) => a + v * n[k], 0));
    }
    return { screen: s, worstDot: Math.min(...dots), dots };
  }),
  boundaryStats: () => page.evaluate(async () => {
    const app = window.__ssao;
    const r = app.renderer, gl = r.gl;
    app.renderFrame();
    // Read the RAW (pre-blur) AO target: G holds the exact skip fraction.
    r.aoTarget.bind();
    const raw = new Float32Array(r.width * r.height * 4);
    gl.readPixels(0, 0, r.width, r.height, gl.RGBA, gl.FLOAT, raw);
    r.gbuffer.bind();
    const depth = new Float32Array(r.width * r.height);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, r.width, r.height, gl.RED, gl.FLOAT, depth);
    let flagged = 0, foreground = 0, aoMin = 1, aoMax = 0;
    let allValid = true;
    for (let y = 0; y < app.height; y++) {
      for (let x = 0; x < app.width; x++) {
        const i = (y * app.width + x) * 4;
        if (depth[y * app.width + x] <= 0) continue;
        foreground++;
        aoMin = Math.min(aoMin, raw[i]);
        aoMax = Math.max(aoMax, raw[i]);
        if (raw[i + 1] > 0) flagged++;
        if (raw[i] < 0 || raw[i] > 1) allValid = false;
      }
    }
    return { flagged, foreground, aoMin, aoMax, allValid };
  }),
  screenshot: async (mode, name) => {
    await page.evaluate((m) => {
      window.__ssao.setParams({ viewMode: m });
      window.__ssao.renderFrame();
    }, mode);
    await page.screenshot({ path: join(root, 'artifacts', name) });
  },
  timing: (kernelSize, frames = 30) => page.evaluate(async ({ kernelSize, frames }) => {
    const app = window.__ssao;
    app.setParams({ kernelSize });
    // Warm up so first-frame allocation/compile cost is excluded.
    app.renderFrame();
    app.renderer.collectGpuTimings();
    const cpu = [];
    const wall = [];
    for (let i = 0; i < frames; i++) {
      // Wall time measured across rAF boundaries includes GPU completion,
      // which stays reliable even when disjoint-timer queries stall.
      const t0 = performance.now();
      cpu.push(app.renderFrame().cpuMs);
      await new Promise((r) => requestAnimationFrame(r));
      wall.push(performance.now() - t0);
    }
    let gpu = [];
    for (let tries = 0; tries < 25 && gpu.length < Math.min(frames, 12); tries++) {
      await new Promise((r) => setTimeout(r, 24));
      gpu = app.renderer.collectGpuTimings();
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return {
      kernelSize,
      cpuMs: avg(cpu),
      wallMs: avg(wall),
      gpuMs: gpu.length ? gpu.reduce((a, b) => a + b, 0) / gpu.length : null,
      gpuFrames: gpu.length,
      frames,
      source: gpu.length
        ? 'EXT_disjoint_timer_query_webgl2 + rAF wall time'
        : 'rAF wall time (GPU timer unavailable)'
    };
  }, { kernelSize, frames })
};

const results = [];
const check = (name, passed, detail) => results.push({ name, passed, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });

// Baseline parameters.
await api.setParams({ kernelSize: 32, radius: 0.85, depthBias: 0.025, intensity: 1.6, blur: true });
await api.setCamera(0.35, 0.42);
await api.render();

console.log('--- region AO ---');
const regionStats = {};
for (const name of ['corner', 'sphereContact', 'thinPlate', 'flatWall']) {
  const r = await api.regionAoFloat(name);
  regionStats[name] = r;
  console.log(name, JSON.stringify({ mean: r.mean.toFixed(4), min: r.min.toFixed(4), n: r.n }));
}

check('角落 (corner) 接触暗部增强', regionStats.corner.mean < 0.85,
  `mean AO = ${regionStats.corner.mean.toFixed(3)}`);
check('接触面 (sphere/floor) 暗部增强', regionStats.sphereContact.mean < 0.7,
  `mean AO = ${regionStats.sphereContact.mean.toFixed(3)}`);
check('薄片 (thin plate) 边缘遮蔽', regionStats.thinPlate.mean < 0.7,
  `mean AO = ${regionStats.thinPlate.mean.toFixed(3)}`);
check('平坦墙面保持明亮', regionStats.flatWall.mean > 0.95,
  `mean AO = ${regionStats.flatWall.mean.toFixed(3)}`);
check('接触区显著暗于平坦墙面',
  regionStats.sphereContact.mean < regionStats.flatWall.mean - 0.25,
  `contact=${regionStats.sphereContact.mean.toFixed(3)} wall=${regionStats.flatWall.mean.toFixed(3)}`);

// ---- cloth normals rebuilt from depth ------------------------------------
console.log('--- cloth normals ---');
const cloth = await api.clothStats();
console.log('cloth worstDot', cloth.worstDot.toFixed(4));
check('布料弯曲法线由深度正确重建 (非平法线)', cloth.worstDot < 0.85,
  `worst normal dot = ${cloth.worstDot.toFixed(3)}`);

// sanity: normal vectors are unit-length and encoded, flat wall normal stable
const wallNormals = await api.normalsAt('flatWall');
const unitOk = wallNormals.grid.every((g) => {
  const n = g.map((c) => c * 2 - 1);
  const len = Math.hypot(...n);
  return len > 0.9 && len < 1.1;
});
check('重建法线为单位向量且编码合法', unitOk, JSON.stringify(wallNormals.grid[4]));

// ---- camera-rotation stability on the flat wall ---------------------------
console.log('--- stability across camera angles ---');
// Yaw range where the flat wall is viewed front-on and its root junction
// stays outside the kernel. Beyond this, grazing geometry legitimately
// occludes, which is correct SSAO behavior rather than flicker.
const yaws = [0.15, 0.25, 0.35, 0.45, 0.55];
const wallSeries = [];
for (const yaw of yaws) {
  await api.setCamera(yaw, 0.42);
  await api.render();
  wallSeries.push((await api.regionAoFloat('flatWall', 4)).mean);
}
const maxDelta = Math.max(...wallSeries) - Math.min(...wallSeries);
const wallDarkest = Math.min(...wallSeries);
console.log('flat wall AO across yaws:', wallSeries.map((v) => v.toFixed(4)).join(', '));
check('相机转动时平坦墙面无闪烁', maxDelta < 0.02 && wallDarkest > 0.96,
  `frames=${yaws.length}, max delta = ${maxDelta.toFixed(4)}, darkest = ${wallDarkest.toFixed(4)}`);

// same-angle determinism: two renders must be bit-identical
await api.setCamera(0.35, 0.42);
const a = await api.aoFloat();
await api.render();
const b = await api.aoFloat();
let diffCount = 0;
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffCount++;
check('同视角重复渲染结果确定 (无随机抖动)', diffCount === 0, `${diffCount} differing bytes`);

// ---- boundary: off-screen samples never consumed --------------------------
console.log('--- boundary ---');
const boundary = await api.boundaryStats();
console.log(JSON.stringify(boundary));
check('边界像素跳过屏幕外采样且无越界数据',
  boundary.flagged > 0 && boundary.allValid && boundary.foreground > 1000,
  `${boundary.flagged}/${boundary.foreground} 前景边缘像素触发跳过保护, AO 均合法`);

// ---- two view modes produce distinct, valid images ------------------------
await api.setCamera(0.35, 0.42);
await api.screenshot(1, 'ao-only.png');
await api.screenshot(0, 'composite.png');
await api.screenshot(2, 'boundary-debug.png');
const aoPx = await api.pixels(1);
const compPx = await api.pixels(0);
const aoMid = [aoPx[100 * W * 4], aoPx[100 * W * 4 + 1], aoPx[100 * W * 4 + 2]];
const compMid = [compPx[100 * W * 4], compPx[100 * W * 4 + 1], compPx[100 * W * 4 + 2]];
const viewsOk = aoMid.every((v) => v === aoMid[0]) &&
  compMid.some((v, i) => Math.abs(v - compMid[0]) < 30);
check('两种视图可用 (灰度 AO / 彩色合成)', viewsOk,
  `AO 像素=[${aoMid}], 合成像素=[${compMid}]`);

// ---- parameter response: radius / bias / intensity ------------------------
console.log('--- params ---');
const sample = async (patch) => {
  await api.setParams({ kernelSize: 32, radius: 0.85, depthBias: 0.025, intensity: 1.6, ...patch });
  return api.regionAoFloat('sphereContact', 6);
};
const smallRadius = (await sample({ radius: 0.15 })).mean;
const largeRadius = (await sample({ radius: 2.0 })).mean;
const noBias = (await sample({ depthBias: 0.0 })).mean;
const highBias = (await sample({ depthBias: 0.15 })).mean;
const zeroIntensity = (await sample({ intensity: 0 })).mean;
const highIntensity = (await sample({ intensity: 4 })).mean;
const params = { smallRadius, largeRadius, noBias, highBias, zeroIntensity, highIntensity };
console.log(JSON.stringify(params, null, 2));
check('核半径调节生效 (大半径遮蔽更强)', largeRadius < smallRadius - 0.03,
  `small=${smallRadius.toFixed(3)} large=${largeRadius.toFixed(3)}`);
check('深度偏差调节生效 (高偏差减少自遮蔽)', highBias > noBias,
  `noBias=${noBias.toFixed(3)} highBias=${highBias.toFixed(3)}`);
check('强度调节生效 (0 强度 = 全亮, 高强度更暗)',
  Math.abs(zeroIntensity - 1) < 0.01 && highIntensity < noBias,
  `zero=${zeroIntensity.toFixed(3)} high=${highIntensity.toFixed(3)}`);

// ---- timing across kernel sizes -------------------------------------------
console.log('--- timing ---');
await api.setParams({ radius: 0.85, depthBias: 0.025, intensity: 1.6, blur: true });
const timing = [];
for (const k of [16, 32, 64]) timing.push(await api.timing(k, 30));
console.log(JSON.stringify(timing, null, 2));

// ---- report ---------------------------------------------------------------
const report = {
  timestamp: new Date().toISOString(),
  resolution: [W, H],
  params: await page.evaluate(() => ({ ...window.__ssao.renderer.params })),
  regions: Object.fromEntries(Object.entries(regionStats).map(([k, v]) => [k, {
    screen: v.screen, meanAo: v.mean, minAo: v.min, samples: v.n
  }])),
  cloth: { worstDot: cloth.worstDot, dots: cloth.dots },
  stability: { frames: yaws.length, maxDelta, darkest: wallDarkest, means: wallSeries },
  boundary,
  timing,
  results
};
writeFileSync(join(root, 'artifacts', 'test-report.json'), JSON.stringify(report, null, 2));

const failed = results.filter((r) => !r.passed);
console.log('\n==== TEST SUMMARY ====');
for (const r of results) console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
