// End-to-end CSM verification in headless Chrome (SwiftShader WebGL2).
// 1. Loads the demo, prints per-cascade coverage + texel density.
// 2. Sweeps the camera across both cascade boundaries in 1 m steps and
//    asserts frame-to-frame difference has no spike (no shadow pop).
// 3. Saves normal + debug-tint screenshots to artifacts/.
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;

// Pick a definitely-free port (this machine runs other sessions' servers).
import net from 'node:net';
const PORT = await new Promise((resolve) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
});

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle0' });
  const title = await page.evaluate(() => document.title);
  if (!title.includes('CSM')) throw new Error('unexpected page (port collision?): ' + title);
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await new Promise(r => setTimeout(r, 1000));
    ready = await page.evaluate(() => typeof window.__csm === 'object');
  }
  if (!ready) throw new Error('page did not initialize __csm');
  await new Promise(r => setTimeout(r, 1500)); // let a few frames render

  // --- 1. stats ---
  const stats = await page.evaluate(() => window.__csm.stats());
  console.log('splits (m):', stats.splits.map(s => s.toFixed(2)).join(' / '));
  for (const c of stats.cascades) {
    console.log(
      `C${c.cascade}: cover ${c.rangeStart.toFixed(1)}-${c.rangeEnd.toFixed(1)} m ` +
      `(span ${c.coverage.toFixed(1)} m), res ${c.resolution}px, ` +
      `density ${c.texelDensity.toFixed(2)} texel/m, depth ${c.depthNear.toFixed(0)}..${c.depthFar.toFixed(0)}`);
  }

  // --- 2. sweep across boundaries, measure frame-to-frame diff ---
  // Camera looks at -Z from (0,12,z); pixels near the split distance cross
  // cascade boundaries as z changes. 1 m steps from z=10 to z=80.
  const diffs = await page.evaluate(() => {
    const out = [];
    let prev = null;
    for (let z = 10; z <= 80; z += 2) {
      window.__csm.setCamera([0, 12, z], Math.PI, -0.3);
      const snap = window.__csm.snapshot();
      if (prev) {
        let sum = 0, changed = 0;
        for (let i = 0; i < snap.pixels.length; i += 16) { // strided sample
          const d = Math.abs(snap.pixels[i] - prev.pixels[i]);
          sum += d;
          if (d > 40) changed++;
        }
        out.push({ z, mean: sum / (snap.pixels.length / 16), changedPct: 100 * changed / (snap.pixels.length / 64) });
      }
      prev = snap;
    }
    return out;
  });
  const means = diffs.map(d => d.mean).sort((a, b) => a - b);
  const median = means[Math.floor(means.length / 2)];
  const maxStep = diffs.reduce((a, b) => (b.mean > a.mean ? b : a));
  console.log(`sweep: median step diff ${median.toFixed(3)}, max step diff ${maxStep.mean.toFixed(3)} at z=${maxStep.z}`);
  const maxChanged = diffs.reduce((a, b) => (b.changedPct > a.changedPct ? b : a));
  console.log(`max changed-pixel fraction in one step: ${maxChanged.changedPct.toFixed(2)}% at z=${maxChanged.z}`);
  if (maxStep.mean > 3 * median + 0.5) {
    console.error(`FAIL: shadow pop detected at z=${maxStep.z} (diff ${maxStep.mean.toFixed(3)} vs median ${median.toFixed(3)})`);
    process.exitCode = 1;
  } else {
    console.log('PASS: no shadow pop across cascade boundaries');
  }

  // --- 3. screenshots ---
  fs.mkdirSync(ROOT + 'artifacts', { recursive: true });
  await page.evaluate(() => window.__csm.setCamera([0, 12, 30], Math.PI, -0.3));
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: ROOT + 'artifacts/csm_normal.png' });
  await page.keyboard.press('d'); // cascade tint debug
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: ROOT + 'artifacts/csm_debug_cascades.png' });
  await page.keyboard.press('d'); // blend band debug
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: ROOT + 'artifacts/csm_debug_blend.png' });
  console.log('screenshots saved to artifacts/');
} finally {
  await browser.close();
  server.kill();
}
