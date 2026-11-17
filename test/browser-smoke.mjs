// Headless-browser smoke test: loads the app, runs the in-page self-test,
// verifies all checks pass, and captures a viewport screenshot.
// Run: node test/browser-smoke.mjs

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
};
const server = http.createServer(async (req, res) => {
  try {
    const path = normalize(join(ROOT, decodeURIComponent(req.url.split('?')[0])));
    const file = path.endsWith('/') ? join(path, 'index.html') : path;
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

let exitCode = 0;
try {
  const browser = await puppeteer.launch({
    headless: 'shell',
    args: [
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (err) => {
    console.error('PAGE ERROR:', err.message);
    exitCode = 1;
  });
  page.on('console', (msg) => console.log('CONSOLE:', msg.text()));
  page.on('requestfailed', (req) => console.error('REQ FAILED:', req.url()));
  page.on('response', (res) => {
    if (res.status() >= 400) console.error('HTTP', res.status(), res.url());
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => {
    const el = document.getElementById('stats');
    return el && el.textContent.includes('绘制节点');
  });

  // In-page self-test.
  await page.click('#selftest');
  await page.waitForFunction(() => {
    const log = document.getElementById('log');
    return log && log.textContent.includes('自检完成');
  });
  const logText = await page.$eval('#log', (el) => el.textContent);
  console.log('--- in-page self-test log ---');
  console.log(logText.trim());
  if (logText.includes('FAIL') || !logText.includes('0 失败')) {
    console.error('SELF-TEST FAILED');
    exitCode = 1;
  }

  // Stats panel reflects the culling/draw counts.
  const stats = await page.$eval('#stats', (el) => el.textContent);
  console.log('--- stats panel ---');
  console.log(stats.trim());
  if (!stats.includes('绘制节点: 10') || !stats.includes('剔除节点: 0')) {
    console.error('STATS MISMATCH');
    exitCode = 1;
  }

  // Simulate a drag on the canvas: selected node (Turret) subtree updates.
  const canvas = await page.$('#viewport');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 30, { steps: 6 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const statsAfterDrag = await page.$eval('#stats', (el) => el.textContent);
  console.log('--- stats after drag ---');
  console.log(statsAfterDrag.trim());
  if (!statsAfterDrag.includes('更新矩阵节点数: 3')) {
    console.error('DRAG UPDATE COUNT MISMATCH (expected subtree of 3)');
    exitCode = 1;
  }

  await page.screenshot({ path: 'artifacts/viewport.png' });
  await browser.close();
  console.log(exitCode === 0 ? 'BROWSER SMOKE TEST PASSED' : 'BROWSER SMOKE TEST FAILED');
} finally {
  server.close();
}
process.exit(exitCode);
