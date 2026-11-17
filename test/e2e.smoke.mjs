// Headless smoke test: loads the viewer, places a measurement by clicking,
// deforms/scales the mesh, subdivides (invalidation), and checks save/load.
// Run: node test/e2e.smoke.mjs  (requires puppeteer + local chrome)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const EXECUTABLE =
  process.env.CHROME_PATH ??
  '/tmp/chs/chrome-headless-shell-linux64/chrome-headless-shell';

const PORT = 8123;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: EXECUTABLE,
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,800',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('#meshSelect option'));

  const glOk = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  });
  assert.ok(glOk, 'WebGL2 context available');

  // Arm measure mode and click two points near the sphere (left of center).
  await page.click('#btnMeasure');
  const clickAt = async (x, y) => {
    await page.mouse.click(x, y);
    await new Promise((r) => setTimeout(r, 150));
  };
  // Sphere is at world (-1.6,0,0); with default camera it projects left-of-center.
  await clickAt(430, 380);
  await clickAt(500, 430);

  await page.waitForFunction(
    () => document.querySelector('#measureList li')?.textContent.includes('直线'),
    { timeout: 3000 }
  );
  const text1 = await page.$eval('#measureList li', (el) => el.textContent);
  assert.match(text1, /直线 [\d.]+/, 'straight distance shown');
  assert.match(text1, /沿表面/, 'surface distance shown');
  console.log('measurement:', text1.trim());

  const distOf = (t) => parseFloat(t.match(/直线 ([\d.]+)/)[1]);
  const d1 = distOf(text1);

  // Vertex deformation: distance should change, anchor stays valid.
  await page.select('#meshSelect', await page.$eval('#meshSelect option', (o) => o.value));
  await page.$eval('#deform', (el) => {
    el.value = '0.9';
    el.dispatchEvent(new Event('input'));
  });
  await new Promise((r) => setTimeout(r, 400));
  const text2 = await page.$eval('#measureList li', (el) => el.textContent);
  assert.ok(!text2.includes('失效'), 'still valid after deform');
  console.log('after deform:', text2.trim());

  // Non-uniform scale: straight distance must change.
  await page.$eval('#scaleX', (el) => {
    el.value = '2.5';
    el.dispatchEvent(new Event('input'));
  });
  await new Promise((r) => setTimeout(r, 400));
  const text3 = await page.$eval('#measureList li', (el) => el.textContent);
  assert.ok(distOf(text3) !== distOf(text2), 'distance changes under non-uniform scale');
  console.log('after scaleX=2.5:', text3.trim());

  // Camera orbit (view switch): anchors must keep same world distance.
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(900, 300, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const text4 = await page.$eval('#measureList li', (el) => el.textContent);
  assert.ok(Math.abs(distOf(text4) - distOf(text3)) < 1e-3, 'distance invariant under camera move');
  console.log('after orbit:', text4.trim());

  // Topology change: measurement must be marked invalid, not remapped.
  await page.click('#btnSubdivide');
  await new Promise((r) => setTimeout(r, 400));
  const text5 = await page.$eval('#measureList li', (el) => el.textContent);
  assert.match(text5, /失效/, 'invalid after subdivide');
  assert.match(text5, /拓扑/, 'reason mentions topology');
  console.log('after subdivide:', text5.trim());

  // Rebind: click the rebind button, then click on the (subdivided) sphere.
  await page.click('#measureList li button');
  await clickAt(430, 380);
  await new Promise((r) => setTimeout(r, 300));
  const text6 = await page.$eval('#measureList li', (el) => el.textContent);
  console.log('after rebind A:', text6.trim());

  // Load a saved record: anchors reference the torus (mesh-2, topology v1,
  // untouched) so the loaded measurement must come back valid.
  const { writeFileSync } = await import('node:fs');
  const record = {
    format: 'mesh-measurements',
    version: 1,
    measurements: [
      {
        id: 99,
        a: { meshId: 'mesh-2', triIndex: 40, u: 0.3, v: 0.3, topologyVersion: 1 },
        b: { meshId: 'mesh-2', triIndex: 120, u: 0.5, v: 0.2, topologyVersion: 1 },
      },
    ],
  };
  writeFileSync('/tmp/measurements-load.json', JSON.stringify(record));
  const input = await page.$('#fileInput');
  await input.uploadFile('/tmp/measurements-load.json');
  await new Promise((r) => setTimeout(r, 300));
  const items = await page.$$eval('#measureList li', (els) =>
    els.map((el) => el.textContent)
  );
  assert.equal(items.length, 2, 'loaded record appended');
  assert.match(items[1], /直线 [\d.]+/, 'loaded measurement is valid');
  console.log('loaded record:', items[1].trim());

  assert.deepEqual(errors, [], 'no page errors');
  console.log('E2E SMOKE OK');
} finally {
  await browser.close();
  server.kill();
}
