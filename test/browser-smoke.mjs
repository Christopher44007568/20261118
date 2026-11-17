import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const mime = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url;
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1320, height: 1000 } });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForTimeout(1500);
await page.click('#btn-pause');
await page.waitForTimeout(200);

const initial = await page.evaluate(() => ({
  glInfo: document.getElementById('gl-info').textContent,
  total: document.getElementById('ft-total').textContent,
  memTotal: document.getElementById('mem-total').textContent,
  depthBadge: document.getElementById('chk-resolve-depth').textContent,
  fboBadge: document.getElementById('chk-fbo-status').textContent,
  clearBadge: document.getElementById('chk-depth-clear').textContent,
  buttons: Array.from(document.querySelectorAll('.mode-btn')).map((b) => ({
    text: b.textContent, disabled: b.disabled,
  })),
}));
console.log('初始状态:', JSON.stringify(initial, null, 2));

for (const samples of [2, 4, 1]) {
  const btn = `button[data-samples="${samples}"]`;
  const disabled = await page.$eval(btn, (b) => b.disabled);
  if (disabled) {
    console.log(`跳过 ${samples}x（设备不支持）`);
    continue;
  }
  await page.click(btn);
  await page.waitForTimeout(900);
  const stats = await page.evaluate(() => ({
    samples: document.querySelector('.mode-btn.active').textContent,
    total: document.getElementById('ft-total').textContent,
    geometry: document.getElementById('ft-geometry').textContent,
    resolve: document.getElementById('ft-resolve').textContent,
    present: document.getElementById('ft-present').textContent,
    gpu: document.getElementById('ft-gpu').textContent,
    memColor: document.getElementById('mem-ms-color').textContent,
    memDepth: document.getElementById('mem-ms-depth').textContent,
    memTex: document.getElementById('mem-color-tex').textContent,
    memTotal: document.getElementById('mem-total').textContent,
    badges: [
      document.getElementById('chk-resolve-depth').textContent,
      document.getElementById('chk-depth-clear').textContent,
      document.getElementById('chk-fbo-status').textContent,
    ],
  }));
  console.log(`\n=== ${samples}x ===`);
  console.log(JSON.stringify(stats, null, 2));

  // 统计当前 resolve 纹理中的边缘混合像素，量化 MSAA 对边缘的影响
  const edgeCount = await page.evaluate(async () => {
    const mod = await import('/js/inspector.js');
    const debug = window.__msaaDebug;
    const result = mod.analyzeFrame(debug.gl, debug.getTarget());
    return { edge: result.edge, mass: result.mass };
  });
  console.log(`边缘混合像素: ${edgeCount.edge.toLocaleString()}，覆盖质量: ${edgeCount.mass.toFixed(0)}`);

  // 动画已暂停，三种模式几何姿态一致，可直接对比边缘锯齿
  await page.$eval('#glcanvas', (el) => el.scrollIntoView({ block: 'center' }));
  await page.locator('#glcanvas').screenshot({
    path: new URL(`../artifacts/canvas-${samples}x.png`, import.meta.url).pathname,
  });
}

await page.click('#btn-depth-test');
await page.waitForTimeout(300);
const depthResult = await page.$eval('#depth-test-result', (el) => el.textContent);
console.log('\n深度行为测试:', depthResult);

await page.click('#btn-shape');
await page.waitForTimeout(200);
const shape = await page.evaluate(() => ({
  bg: document.getElementById('shape-bg').textContent,
  fg: document.getElementById('shape-fg').textContent,
  edge: document.getElementById('shape-edge').textContent,
  mass: document.getElementById('shape-mass').textContent,
}));
console.log('形状分析(1x):', JSON.stringify(shape));

await page.click('button[data-samples="4"]');
await page.waitForTimeout(600);
await page.click('#btn-shape');
await page.waitForTimeout(200);
const shape4 = await page.evaluate(() => ({
  edge: document.getElementById('shape-edge').textContent,
  mass: document.getElementById('shape-mass').textContent,
  delta: document.getElementById('shape-delta').textContent,
}));
console.log('形状分析(4x):', JSON.stringify(shape4));

  // 像素检查器：移动到画布中央（使用画布的实际包围盒）
  await page.$eval('#glcanvas', (el) => el.scrollIntoView({ block: 'center' }));
  const box = await page.$eval('#glcanvas', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.3 };
  });
  const hit = await page.evaluate((p) => {
    const el = document.elementFromPoint(p.x, p.y);
    return el ? el.id || el.tagName : 'null';
  }, box);
  console.log('鼠标位置命中元素:', hit);
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(300);
  const pixelInfo = await page.$eval('#pixel-info', (el) => el.textContent);
  console.log('\n像素检查器(hover):', JSON.stringify(pixelInfo));
  if (!pixelInfo.includes('检查点')) throw new Error('像素检查器未响应鼠标移动');

  await page.mouse.click(box.x + 40, box.y + 40);
  await page.waitForTimeout(200);
  const lockedInfo = await page.$eval('#pixel-info', (el) => el.textContent);
  console.log('像素检查器(锁定):', JSON.stringify(lockedInfo));
  if (!lockedInfo.includes('锁定')) throw new Error('锁定检查点失败');

  // 扫描画布，找到一个边缘混合像素（覆盖率在 10%~90%），验证 MSAA 中间色可读
  const edgePixel = await page.evaluate(async () => {
    const mod = await import('/js/inspector.js');
    const debug = window.__msaaDebug;
    const target = debug.getTarget();
    const { pixels, size: _ } = mod.readResolvePixels(
      debug.gl, target,
      Math.floor(target.width / 2), Math.floor(target.height / 2),
      Math.floor(Math.min(target.width, target.height) / 3)
    );
    const size = Math.floor(Math.min(target.width, target.height) / 3) * 2 + 1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const d = Math.hypot(pixels[i] - 10, pixels[i + 1] - 14, pixels[i + 2] - 24);
        if (d > 25 && d < 180) {
          return { x, y, rgb: [pixels[i], pixels[i + 1], pixels[i + 2]] };
        }
      }
    }
    return null;
  });
  console.log('找到边缘混合像素:', JSON.stringify(edgePixel));
  if (!edgePixel) throw new Error('未找到边缘混合像素');

  // 故障模式
  await page.click('#btn-bug');
  await page.waitForTimeout(700);
  const bugBadge = await page.$eval('#chk-depth-clear', (el) => el.textContent);
  console.log('故障模式徽章:', bugBadge);
  await page.click('#btn-bug');

  await page.screenshot({ path: new URL('../artifacts/smoke-final.png', import.meta.url).pathname });

  await browser.close();
  server.close();

  if (errors.length) {
    console.error('\n控制台错误:');
    errors.forEach((e) => console.error(' - ' + e));
    process.exit(1);
  }
  console.log('\n浏览器冒烟测试全部通过，无控制台错误。');
