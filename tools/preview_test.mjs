// Headless smoke test: serves the repo, opens the WebGL2 preview in
// Chromium (SwiftShader), exercises the UI and captures screenshots.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'artifacts');
mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'web/index.html');
  const file = existsSync(path) && !path.endsWith('/') ? path : join(path, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(8123, r));

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto('http://127.0.0.1:8123/web/index.html');
await page.waitForFunction(() => document.getElementById('status').textContent.includes('已生成'), null, { timeout: 20000 });
console.log('status:', await page.textContent('#status'));
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, 'preview_split.png') });

// Mip-level debug at high tile count, zoomed out: distant/steep pixels must
// show higher LOD colors, proving the mip chain (not a blur) is in use.
await page.selectOption('#channel', '6');
await page.locator('#tiles').fill('8');
await page.evaluate(() => { window.dispatchEvent(new Event('resize')); });
await page.mouse.move(640, 400);
await page.mouse.wheel(0, 900);
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'preview_mipdebug.png') });

// Plane only, low sun (oblique), shaded channel.
await page.selectOption('#channel', '0');
await page.selectOption('#geom', 'plane');
await page.locator('#tiles').fill('3');
await page.locator('#lightEl').fill('12');
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'preview_plane_oblique.png') });

// Sphere only, seed B, shaded.
await page.selectOption('#geom', 'sphere');
await page.selectOption('#seedPreset', '9876');
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'preview_sphere_seedB.png') });

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
