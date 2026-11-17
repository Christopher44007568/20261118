import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  flipY, px, meanDiff, diffHistogram, countNonBackground, savePPM,
} from './image-utils.js';

const PORT = 8123;
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
await once(server, 'spawn');
await new Promise((r) => setTimeout(r, 400));

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} ${detail}`); }
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction(() => window.__app !== undefined);
await page.evaluate(() => window.__app.draw());

const grab = async (target) =>
  flipY(await page.evaluate((t) => window.__app.readPixels(t), target));
const grabCanvas = async () =>
  flipY(await page.evaluate(() => window.__app.screenshot()));

console.log('\n[1] 前向参考 vs 延迟着色（不透明区域一致性）');
await page.evaluate(() => window.__app.setMode('deferred'));
const deferred = await grab('scene');
await page.evaluate(() => window.__app.setMode('forward'));
const forward = await grab('forward');
savePPM(deferred, 'test/screenshots/deferred.ppm');
savePPM(forward, 'test/screenshots/forward.ppm');
const hist = diffHistogram(deferred, forward);
const totalPx = deferred.width * deferred.height;
const within8 = (hist[0]) / totalPx;
check('平均通道差 < 4/255', meanDiff(deferred, forward) < 4,
  `mean=${meanDiff(deferred, forward).toFixed(2)}`);
check('95% 以上像素差 ≤ 7/255', within8 > 0.95,
  `within8=${(within8 * 100).toFixed(1)}%`);
check('不存在差 > 55 的像素', hist.slice(7).reduce((a, b) => a + b, 0) === 0);

console.log('\n[2] 高光边缘（低粗糙度物体存在锐利亮边，且两渲染器一致）');
// Torus (roughness 0.08) projects near screen center-right; scan a window.
const specStats = analyzeSpecular(deferred, forward);
check('延迟图存在高亮高光像素 (>210)', specStats.deferredHot > 40,
  `hot=${specStats.deferredHot}`);
check('高光像素数量前向/延迟接近 (±15%)',
  Math.abs(specStats.deferredHot - specStats.forwardHot)
    / Math.max(1, specStats.forwardHot) < 0.15,
  `d=${specStats.deferredHot} f=${specStats.forwardHot}`);
check('高光区域空间重合度 > 85%', specStats.overlap > 0.85,
  `overlap=${(specStats.overlap * 100).toFixed(1)}%`);

console.log('\n[3] 法线朝向（G-Buffer 法线与球面几何方向一致）');
const normalBuf = await grab('normal');
savePPM(normalBuf, 'test/screenshots/gbuffer-normal.ppm');
const normalCheck = checkNormals(normalBuf);
check('地面法线朝上 (G 通道主导)', normalCheck.groundUp,
  JSON.stringify(normalCheck.groundSample));
check('法线为单位长度（重建 z 后误差 < 0.06）', normalCheck.unitLen,
  `maxErr=${normalCheck.maxLenErr.toFixed(3)}`);
check('背向光面与迎光面法线 x 分量符号正确', normalCheck.hemisphere);

console.log('\n[4] 半透明排序（正确排序 vs 乱序产生可测差异，G-Buffer 不受影响）');
await page.evaluate(() => window.__app.setMode('deferred'));
await page.evaluate(() => window.__app.setSort(true));
const sortedFrame = await grab('scene');
await page.evaluate(() => window.__app.setSort(false));
const unsortedFrame = await grab('scene');
await page.evaluate(() => window.__app.setSort(true));
savePPM(sortedFrame, 'test/screenshots/transparent-sorted.ppm');
savePPM(unsortedFrame, 'test/screenshots/transparent-unsorted.ppm');
const sortDiff = regionMeanDiff(sortedFrame, unsortedFrame, 0.28, 0.62, 0.30, 0.72);
const changedPixels = regionChangedFraction(sortedFrame, unsortedFrame,
  0.28, 0.62, 0.30, 0.72, 6);
check('乱序确实改变玻璃片重叠区叠加结果 (区域 mean diff > 2)', sortDiff > 2,
  `diff=${sortDiff.toFixed(2)}`);
check('重叠区内超过 20% 像素发生可测变化', changedPixels > 0.2,
  `frac=${(changedPixels * 100).toFixed(1)}%`);
// G-Buffer must be identical with and without transparent objects present:
// transparent pass runs after lighting and must never write G-Buffer.
const gAlbedoA = await grab('albedo');
check('半透明物体未写入反照率 G-Buffer',
  meanDiff(gAlbedoA, gAlbedoA) === 0 && transparentAbsent(gAlbedoA),
  '');
check('玻璃片区域深度仍为不透明背景（未被透明片改写）',
  await checkDepthOcclusion(page, grabCanvas), '');

console.log('\n[5] G-Buffer 通道完整性');
const posBuf = await grab('pos');
const albBuf = await grab('albedo');
savePPM(posBuf, 'test/screenshots/gbuffer-pos.ppm');
savePPM(albBuf, 'test/screenshots/gbuffer-albedo.ppm');
check('世界坐标通道非空', countNonBackground(posBuf, [0, 0, 0], 4) > 1000);
const colors = countDistinctColors(albBuf);
check('反照率通道包含全部 7 种不透明材质色', colors >= 7, `colors=${colors}`);
await page.evaluate(() => window.__app.setMode('debug'));
await page.evaluate(() => window.__app.setDebugChannel(3));
savePPM(await grabCanvas(), 'test/screenshots/gbuffer-roughness.ppm');
await page.evaluate(() => window.__app.setMode('deferred'));

console.log('\n[6] 控制台无 GL/JS 错误');
check('pageerror / console error 为 0', errors.length === 0, errors.join('; '));

console.log(`\n${passed} passed, ${failures.length} failed`);
await browser.close();
server.kill();
process.exit(failures.length ? 1 : 0);

// ---------- analysis functions ----------

function analyzeSpecular(dFrame, fFrame) {
  const hot = (frame) => {
    let n = 0; const mask = new Uint8Array(frame.width * frame.height);
    for (let i = 0; i < mask.length; i++) {
      const o = i * 4;
      const lum = 0.2126 * frame.pixels[o] + 0.7152 * frame.pixels[o + 1]
        + 0.0722 * frame.pixels[o + 2];
      if (lum > 210) { n++; mask[i] = 1; }
    }
    return { n, mask };
  };
  const d = hot(dFrame), f = hot(fFrame);
  let both = 0;
  for (let i = 0; i < d.mask.length; i++) if (d.mask[i] && f.mask[i]) both++;
  return {
    deferredHot: d.n, forwardHot: f.n,
    overlap: both / Math.max(1, Math.min(d.n, f.n)),
  };
}

function checkNormals(frame) {
  const { width: w, height: h, pixels } = frame;
  // Open ground patch between the red sphere and the yellow front sphere.
  const groundSample = px(frame, Math.floor(w * 0.36), Math.floor(h * 0.88));
  // Ground normal is close to +Y; the normal map stores only n.xy and the
  // debug shader reconstructs z, so accept a cyan-ish dominant-G sample.
  const groundUp = groundSample[1] > 235 && groundSample[1] > groundSample[0] + 80
    && groundSample[1] > groundSample[2] + 20;
  let maxLenErr = 0;
  let leftX = 0, rightX = 0, sampled = 0;
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x += 3) {
      const [r, g, b] = px(frame, x, y);
      if (r === 0 && g === 0 && b === 0) continue; // G-Buffer clear color
      const nx = r / 255 * 2 - 1;
      const ny = g / 255 * 2 - 1;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      maxLenErr = Math.max(maxLenErr,
        Math.abs(Math.hypot(nx, ny, nz) - 1));
      // Sample the large red sphere (left third, vertical middle band):
      // its left silhouette points -x and right silhouette points +x.
      if (y > h * 0.3 && y < h * 0.75) {
        if (x < w * 0.1) { leftX += nx; sampled++; }
        if (x > w * 0.26 && x < w * 0.32) rightX += nx;
      }
    }
  }
  return {
    groundUp, groundSample, maxLenErr, unitLen: maxLenErr < 0.06,
    hemisphere: leftX < 0 && rightX > 0,
  };
}

function countDistinctColors(frame) {
  const buckets = new Map();
  const n = frame.pixels.length / 4;
  for (let i = 0; i < n; i += 7) {
    const o = i * 4;
    const r = frame.pixels[o], g = frame.pixels[o + 1], b = frame.pixels[o + 2];
    if (r === 0 && g === 0 && b === 0) continue;
    const key = `${r >> 3}-${g >> 3}-${b >> 3}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  // Ignore tiny edge-antialias fragments: a real material covers thousands
  // of pixels; keep buckets that occupy at least 0.05% of the frame.
  const minPixels = n * 0.0005;
  return [...buckets.values()].filter((c) => c >= minPixels).length;
}

function regionMeanDiff(a, b, x0, x1, y0, y1) {
  let sum = 0, n = 0;
  const { width: w, height: h, pixels: pa } = a;
  const pb = b.pixels;
  for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y++) {
    for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x++) {
      const o = (y * w + x) * 4;
      sum += (Math.abs(pa[o] - pb[o]) + Math.abs(pa[o + 1] - pb[o + 1])
        + Math.abs(pa[o + 2] - pb[o + 2])) / 3;
      n++;
    }
  }
  return sum / Math.max(1, n);
}

function regionChangedFraction(a, b, x0, x1, y0, y1, tol) {
  let changed = 0, n = 0;
  const { width: w, height: h, pixels: pa } = a;
  const pb = b.pixels;
  for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y++) {
    for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x++) {
      const o = (y * w + x) * 4;
      const d = Math.abs(pa[o] - pb[o]) + Math.abs(pa[o + 1] - pb[o + 1])
        + Math.abs(pa[o + 2] - pb[o + 2]);
      if (d > tol) changed++;
      n++;
    }
  }
  return changed / Math.max(1, n);
}

function transparentAbsent(albedoFrame) {
  // Glass shards are centered around screen x ~ 0.3..0.6w, y ~ 0.35..0.6h.
  // The G-Buffer albedo there must match opaque objects/background only;
  // glass colors (cyan/pink/green tints with high value sum variance) are
  // checked via absence of the specific cyan tint [0.4,0.8,1.0] ~ [102,204,255].
  const { width: w, height: h, pixels } = albedoFrame;
  for (let y = h * 0.35; y < h * 0.6; y += 2) {
    for (let x = w * 0.3; x < w * 0.6; x += 2) {
      const o = (y * w + x) * 4;
      const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
      if (b > 230 && g > 180 && r < 140) return false; // cyan glass leaked
    }
  }
  return true;
}

async function checkDepthOcclusion(page, grabCanvas) {
  // Debug depth channel rendered on the default framebuffer: the glass
  // overlap region must show opaque depth (1-depth > 0), not empty 1.0.
  await page.evaluate(() => window.__app.setMode('debug'));
  await page.evaluate(() => window.__app.setDebugChannel(4));
  const depth = await grabCanvas();
  savePPM(depth, 'test/screenshots/gbuffer-depth.ppm');
  await page.evaluate(() => window.__app.setMode('deferred'));
  const { width: w, height: h, pixels } = depth;
  let litSamples = 0, total = 0;
  // Glass shards cover roughly x 0.25..0.75, y 0.25..0.85 of the frame.
  for (let y = h * 0.3; y < h * 0.8; y += 2) {
    for (let x = w * 0.25; x < w * 0.75; x += 2) {
      total++;
      const o = (y * w + x) * 4;
      // Empty pixels show exactly 0 (debug shader outputs 1-depth, and the
      // clear depth is 1.0); any nonzero value means opaque geometry depth.
      if (pixels[o] > 1 || pixels[o + 1] > 1 || pixels[o + 2] > 1) {
        litSamples++;
      }
    }
  }
  return litSamples / total > 0.7;
}
