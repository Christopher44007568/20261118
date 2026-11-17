import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
};

const server = createServer(async (req, res) => {
  const path = join(root, req.url === '/' ? 'index.html' : req.url);
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': mime[extname(path)] || 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => window.__demo, null, { timeout: 30000 });
await page.waitForTimeout(1500);

// 校验右侧面板权重归一（四点插值球）
async function weightSum() {
  return page.evaluate(() => {
    const pcts = [...document.querySelectorAll('.probe-row .pct')].map((el) =>
      parseFloat(el.textContent)
    );
    return pcts.reduce((a, b) => a + b, 0);
  });
}

await page.evaluate(() => window.__demo.setMode('compare'));
for (const t of [0.6, 2.2, 3.8, 5.4]) {
  await page.evaluate((v) => window.__demo.setT(v), t);
  await page.waitForTimeout(700); // 让遮挡平滑收敛
  const sum = await weightSum();
  if (Math.abs(sum - 100) > 0.5) {
    errors.push(`weights not normalized at t=${t}: sum=${sum}`);
  }
}

await page.screenshot({ path: 'artifacts/shot-compare.png' });
for (const m of ['cell', 'nearest', 'tet']) {
  await page.evaluate((v) => window.__demo.setMode(v), m);
  await page.evaluate(() => window.__demo.setT(2.2));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `artifacts/shot-${m}.png` });
}

await browser.close();
server.close();

if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('screenshot test passed, weights normalized, no console errors');
