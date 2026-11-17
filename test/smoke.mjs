// Headless render smoke test: loads the app in Chromium, fails on any
// console/shader error, and captures screenshots to artifacts/.

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(root, 'artifacts', 'shot_free.png') });

// wireframe overlay on
await page.check('#wireToggle');
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(root, 'artifacts', 'shot_wireframe.png') });
await page.uncheck('#wireToggle');

// valley tour
await page.click('#tourValley');
await page.waitForTimeout(6000);
await page.screenshot({ path: path.join(root, 'artifacts', 'shot_valley.png') });

// ridge tour
await page.click('#tourRidge');
await page.waitForTimeout(6000);
await page.screenshot({ path: path.join(root, 'artifacts', 'shot_ridge.png') });

const stats = await page.textContent('#levelStats');
const cam = await page.textContent('#camInfo');
console.log('--- levelStats ---\n' + stats.trim());
console.log('--- camInfo ---\n' + cam.trim());

await browser.close();
server.close();
if (errors.length) {
  console.error('CONSOLE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('SMOKE TEST PASSED (no console errors)');
