// Automated verification for the WebGL2 transform-feedback particle system.
// Scenarios:
//   1. continuous emission  -> active count tracks rate x time, invariant holds
//   2. stop emission        -> natural decay to zero, all slots recycled
//   3. camera fly-through   -> no NaN, no GL errors, no clumping
//   4. long run             -> fixed buffers, bounded heap, stable equilibrium
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const EXE = '/home/hj/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
  try {
    const path = join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--no-sandbox'],
});

let failures = 0;
function check(name, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

// Runs inside the page: spatial spread metrics of alive particles.
function spreadMetrics() {
  const p = window.__sim.readPositions();
  const n = p.length / 3;
  if (n === 0) return { n: 0, nan: 0, radius: 0, clumpFrac: 0 };
  let cx = 0, cy = 0, cz = 0, nan = 0;
  for (let i = 0; i < p.length; i += 3) {
    if (!Number.isFinite(p[i]) || !Number.isFinite(p[i + 1]) || !Number.isFinite(p[i + 2])) nan++;
    cx += p[i]; cy += p[i + 1]; cz += p[i + 2];
  }
  cx /= n; cy /= n; cz /= n;
  let r2 = 0, clump = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - cx, dy = p[i] - cy, dz = p[i] - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    r2 += d2;
    if (d2 < 0.01) clump++; // within 0.1 world units of the centroid
  }
  return { n, nan, radius: Math.sqrt(r2 / n), clumpFrac: clump / n };
}

async function newSimPage(slots) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); failures++; });
  await page.goto(`http://127.0.0.1:${PORT}/index.html?slots=${slots}`);
  await page.waitForFunction(() => window.__sim && window.__sim.ready);
  await page.evaluate(() => { window.__sim.pause(); window.__sim.setDrift(false); });
  return page;
}

async function scenarioEmission() {
  console.log('Scenario 1: continuous emission');
  const page = await newSimPage(32768);
  await page.evaluate(() => {
    window.__sim.setRate(3000);
    window.__sim.setLifetime(4);
    window.__sim.setEmitting(true);
  });
  const samples = [];
  for (let s = 0; s < 5; s++) {
    const st = await page.evaluate(() => {
      window.__sim.step(1 / 60, 60); // 1 simulated second
      return window.__sim.stats();
    });
    samples.push(st);
    check(`t=${s + 1}s invariant active+free==capacity`,
      st.active + st.free === st.capacity, `active=${st.active} free=${st.free}`);
  }
  const last = samples[samples.length - 1];
  // Expected ~3000/s with per-particle lifetime jitter (mean ~4s): after 5s,
  // active should be close to 3000*5 minus deaths (mean life 4s -> some deaths).
  check('active grows with emission', last.active > 9000 && last.active <= 15001,
    `active=${last.active}`);
  check('monotonic growth while below equilibrium',
    samples.every((s, i) => i === 0 || s.active >= samples[i - 1].active));
  check('fixed buffer capacity', last.capacity === 32768 && last.bufferBytes === 32768 * 16 * 4 * 2);
  check('no GL errors', await page.evaluate(() => window.__sim.glError()) === 0);
  check('GPU timer running', last.timerAvailable && last.gpuMs >= 0, `gpuMs=${last.gpuMs.toFixed(3)}`);
  await page.close();
  return last;
}

async function scenarioDecay() {
  console.log('Scenario 2: stop emission -> natural decay');
  const page = await newSimPage(32768);
  await page.evaluate(() => {
    window.__sim.setRate(4000);
    window.__sim.setLifetime(2);
    window.__sim.setEmitting(true);
    window.__sim.step(1 / 60, 180); // 3s of emission
    window.__sim.setEmitting(false);
  });
  const mid = await page.evaluate(() => window.__sim.stats());
  check('population present before stop', mid.active > 5000, `active=${mid.active}`);
  const drain = await page.evaluate(() => {
    const out = [];
    for (let s = 0; s < 8; s++) { // max lifetime is 2 * 1.45 = 2.9s
      window.__sim.step(1 / 60, 60);
      out.push(window.__sim.stats().active);
    }
    return out;
  });
  check('monotonic decay after stop', drain.every((a, i) => i === 0 || a <= drain[i - 1]),
    drain.join(' -> '));
  check('fully drained', drain[drain.length - 1] === 0, `final=${drain[drain.length - 1]}`);
  const st = await page.evaluate(() => window.__sim.stats());
  check('all slots recycled', st.free === st.capacity && st.recycledTotal > 0,
    `free=${st.free} recycled=${st.recycledTotal}`);
  check('death heap empty', st.heapSize === 0);
  await page.close();
}

async function scenarioFlyThrough() {
  console.log('Scenario 3: camera fly-through of the particle cloud');
  const page = await newSimPage(32768);
  await page.evaluate(() => {
    window.__sim.setRate(4000);
    window.__sim.setLifetime(5);
    window.__sim.setEmitting(true);
    window.__sim.step(1 / 60, 240); // build up a dense cloud
  });
  const before = await page.evaluate(spreadMetrics);
  check('cloud formed', before.n > 8000 && before.nan === 0,
    `n=${before.n} radius=${before.radius.toFixed(2)}`);

  // Dive from radius 14 straight through the cloud centre and out the back.
  const frames = await page.evaluate(() => {
    const errs = [];
    for (let i = 0; i <= 140; i++) {
      const t = i / 140;
      const radius = 14 - t * 27.2; // 14 -> -13.2 (through the core)
      window.__sim.setCamera(0.6, 1.15, Math.abs(radius) < 0.4 ? 0.4 : Math.abs(radius));
      window.__sim.step(1 / 60, 1);
      const e = window.__sim.glError();
      if (e !== 0) errs.push(e);
    }
    return errs;
  });
  check('no GL errors during fly-through', frames.length === 0);

  const after = await page.evaluate(spreadMetrics);
  check('no NaN positions after fly-through', after.nan === 0);
  check('cloud did not collapse into a clump',
    after.radius > before.radius * 0.5 && after.clumpFrac < 0.05,
    `radius ${before.radius.toFixed(2)} -> ${after.radius.toFixed(2)}, clumpFrac=${after.clumpFrac.toFixed(4)}`);
  check('cloud did not explode', after.radius < before.radius * 3,
    `radius=${after.radius.toFixed(2)}`);
  await page.close();
}

async function scenarioLongRun() {
  console.log('Scenario 4: long run (10 simulated minutes) — buffer & heap bounds');
  const page = await newSimPage(32768);
  await page.evaluate(() => {
    // Pool sizing rule: capacity >> rate x maxLifetime (32768 vs ~21750 here),
    // so the recycling ring always finds free slots and equilibrium is stable.
    window.__sim.setRate(2500);
    window.__sim.setLifetime(6);
    window.__sim.setEmitting(true);
  });
  const heap0 = await page.evaluate(() => performance.memory
    ? performance.memory.usedJSHeapSize : 0);
  let invariantOk = true, capacityOk = true, nanFree = true, spreadOk = true;
  let minActive = Infinity, maxActive = 0, lastStats = null;
  for (let m = 0; m < 20; m++) { // 20 x 30s = 10 simulated minutes
    const r = await page.evaluate((spreadFn) => {
      window.__sim.step(0.05, 600); // 30 simulated seconds per chunk
      const st = window.__sim.stats();
      const spread = eval(`(${spreadFn})`)();
      return { st, spread, heap: performance.memory ? performance.memory.usedJSHeapSize : 0 };
    }, spreadMetrics.toString());
    const { st, spread } = r;
    lastStats = st;
    if (st.active + st.free !== st.capacity) invariantOk = false;
    if (st.capacity !== 32768 || st.bufferBytes !== 32768 * 16 * 4 * 2) capacityOk = false;
    if (spread.nan !== 0) nanFree = false;
    if (spread.n > 1000 && (spread.radius < 0.3 || spread.clumpFrac > 0.05)) spreadOk = false;
    if (st.time > 8) { minActive = Math.min(minActive, st.active); maxActive = Math.max(maxActive, st.active); }
    if (m === 19) {
      var heap1 = r.heap;
    }
  }
  check('invariant active+free==capacity for 10 min', invariantOk);
  check('buffer capacity never changed', capacityOk);
  check('no NaN positions over 10 min', nanFree);
  check('no clumping over 10 min', spreadOk);
  check('population reaches stable equilibrium',
    maxActive > 0 && minActive > maxActive * 0.75,
    `min=${minActive} max=${maxActive}`);
  check('slots continuously recycled', lastStats.recycledTotal > 100000,
    `recycledTotal=${lastStats.recycledTotal}`);
  if (heap0 && typeof heap1 !== 'undefined') {
    const growthMB = (heap1 - heap0) / 1048576;
    check('JS heap growth bounded (< 64 MB)', growthMB < 64, `growth=${growthMB.toFixed(1)} MB`);
  }
  check('no GL errors at end', await page.evaluate(() => window.__sim.glError()) === 0);
  console.log(`  info: gpuUpdate=${lastStats.gpuMs.toFixed(3)} ms, heapSize=${lastStats.heapSize}`);
  await page.close();
}

async function screenshots() {
  console.log('Screenshots');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.__sim && window.__sim.ready);
  await page.evaluate(() => { window.__sim.pause(); window.__sim.step(1 / 60, 300); });
  await page.screenshot({ path: join(ROOT, 'artifacts', 'particle-desktop.png') });
  await page.evaluate(() => {
    window.__sim.setCamera(0.6, 1.3, 2.2); // inside the cloud
    window.__sim.step(1 / 60, 30);
  });
  await page.screenshot({ path: join(ROOT, 'artifacts', 'particle-desktop-2.png') });
  await page.close();
  console.log('  saved artifacts/particle-desktop.png, artifacts/particle-desktop-2.png');
}

try {
  await scenarioEmission();
  await scenarioDecay();
  await scenarioFlyThrough();
  await scenarioLongRun();
  await screenshots();
} finally {
  await browser.close();
  server.close();
}
console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
