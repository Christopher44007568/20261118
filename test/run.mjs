import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = join(ROOT, 'artifacts', 'shots');
mkdirSync(SHOTS, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  try {
    const path = normalize(join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]));
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(8765, r));

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:8765/index.html');
await page.waitForFunction(() => window.__demo?.ready);
await page.waitForTimeout(1200); // 预热

const results = [];
async function scenario(name, { gap, view }) {
  await page.evaluate(([g, v]) => {
    window.__demo.setAutoBob(false);
    window.__demo.setShadowEnabled(true);
    window.__demo.setFloatGap(g);
    window.__demo.setView(v);
  }, [gap, view]);
  await page.waitForTimeout(400);
  const metrics = await page.evaluate(() => window.__demo.getMetrics());
  const file = join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  results.push({ name, gap, view, metrics, shot: `artifacts/shots/${name}.png` });
  console.log(`✓ ${name}: 悬空球强度=${metrics.objects.floater.shadowIntensity} 缝隙=${metrics.objects.floater.occlusionDepth}`);
  return metrics;
}

// 盒子 / 圆柱贴地 + 悬空球三种高度；主视角与侧视图各一轮
await scenario('A-main-grounded', { gap: 0.0, view: 'main' });
await scenario('A-side-grounded', { gap: 0.0, view: 'side' });
const mid = await scenario('B-side-gap0.35', { gap: 0.35, view: 'side' });
await scenario('B-main-gap0.35', { gap: 0.35, view: 'main' });
const high = await scenario('C-side-gap1.20', { gap: 1.2, view: 'side' });
await scenario('C-main-gap1.20', { gap: 1.2, view: 'main' });

// 额外采样成本：开/关阴影各测一轮帧耗时
await page.evaluate(() => { window.__demo.setView('main'); window.__demo.setFloatGap(0.2); });
await page.evaluate(() => { window.__demo.setShadowEnabled(true); window.__demo.resetTiming(); });
await page.waitForTimeout(3000);
await page.evaluate(() => window.__demo.setShadowEnabled(false)); // 不重置，保留 on 统计
await page.waitForTimeout(3000);
const costMetrics = await page.evaluate(() => window.__demo.getMetrics());
await page.evaluate(() => window.__demo.setShadowEnabled(true));

// --- 断言 ---
const grounded = results.find((r) => r.name === 'A-main-grounded').metrics;
const checks = [
  ['盒子贴地强度高 (>0.7)', grounded.objects.box.shadowIntensity > 0.7],
  ['圆柱贴地强度高 (>0.7)', grounded.objects.cylinder.shadowIntensity > 0.7],
  ['贴地遮挡深度≈0 (<0.02m)', Math.abs(grounded.objects.box.occlusionDepth) < 0.02],
  ['悬空球贴地时强度高 (>0.7)', grounded.objects.floater.shadowIntensity > 0.7],
  ['悬空 0.35m 强度衰减 (0.1~0.7)',
    mid.objects.floater.shadowIntensity > 0.1 && mid.objects.floater.shadowIntensity < 0.7],
  ['悬空 1.2m 阴影消失 (<0.05)', high.objects.floater.shadowIntensity < 0.05],
  ['遮挡深度随高度增长 (1.2m > 0.35m)',
    high.objects.floater.occlusionDepth > mid.objects.floater.occlusionDepth],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
}

const report = {
  technique: '底面高度通道（仰视正交深度）+ 地面每像素 8 次泊松采样，按缝隙高度衰减',
  scenarios: results,
  cost: costMetrics.cost,
  checks: Object.fromEntries(checks.map(([l, ok]) => [l, ok])),
};
writeFileSync(join(ROOT, 'artifacts', 'contact-shadow-report.json'), JSON.stringify(report, null, 2));
console.log('\n成本:', JSON.stringify(costMetrics.cost));
console.log(failed ? `\n${failed} 项断言失败` : '\n全部断言通过');

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
