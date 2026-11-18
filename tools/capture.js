'use strict';
/*
 * Headless validation harness.
 * Renders the study under SwiftShader, switches both hydrodynamic regimes,
 * audits reflection position / shoreline seam / mirror-camera picking, and
 * writes screenshots plus a machine-readable validation report.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'validation');
const CHROME = process.env.CHROME ||
  '/home/hj/.codex-relay-home-0v0b5y9_/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';

const VIEW = { width: 1440, height: 900 };
const args = process.argv.slice(2);
const mobile = args.includes('--mobile');
if (mobile) Object.assign(VIEW, { width: 390, height: 844 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sampleMetrics(page) {
  return page.evaluate(() => {
    const w = window.__water;
    const r = w.renderer;
    const pickCenter = w.pickWater(0, -0.18);
    // Shore probes near both lake margins — must stay inside the water plane.
    const leftShore = w.pickWater(-0.62, -0.05);
    const rightDock = w.pickWater(0.78, -0.1);
    const sky = w.pickWater(0, 0.85);
    return {
      regime: w.regime.label,
      params: {
        speed: w.regime.speed,
        distortion: w.regime.distortion,
        wavelength: w.regime.wavelength,
        mix: w.regime.mix
      },
      reflectionRT: { w: r.stats.rtW, h: r.stats.rtH },
      mirrorMs: Number(r.stats.mirrorMs.toFixed(3)),
      draws: r.stats.draws,
      tris: Number((r.stats.tris / 1000).toFixed(2)),
      leak: w.auditClip(),
      clipRow: r.stats.clipRow
        ? r.stats.clipRow.map((v) => Number(v.toFixed(4)))
        : null,
      mirrorEye: r.stats.mirrorEye
        ? r.stats.mirrorEye.map((v) => Number(v.toFixed(3)))
        : null,
      pick: {
        center: pickCenter.hit
          ? { state: 'SURFACE HIT · MIRROR SAMPLE',
              uv: pickCenter.uv.slice(0, 2).map((v) => Number(v.toFixed(3))),
              world: pickCenter.world.map((v) => Number(v.toFixed(1))) }
          : { state: 'NO WATER HIT' },
        leftShore: leftShore.hit
          ? { state: 'SURFACE HIT · MIRROR SAMPLE',
              uv: leftShore.uv.slice(0, 2).map((v) => Number(v.toFixed(3))),
              world: leftShore.world.map((v) => Number(v.toFixed(1))) }
          : { state: 'NO WATER HIT' },
        rightDock: rightDock.hit
          ? { state: 'SURFACE HIT · MIRROR SAMPLE',
              uv: rightDock.uv.slice(0, 2).map((v) => Number(v.toFixed(3))),
              world: rightDock.world.map((v) => Number(v.toFixed(1))) }
          : { state: 'NO WATER HIT' },
        sky: sky.hit
          ? { state: 'SURFACE HIT', world: sky.world }
          : { state: 'NO WATER HIT' }
      },
      fps: r.stats.fps,
      frame: r.stats.frame
    };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-frame-rate-limit'
    ]
  });
  const page = await browser.newPage();
  await page.setViewport(VIEW);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.__water && window.__water.renderer.stats.frame > 5),
    { timeout: 30000 });
  await sleep(2500);

  const report = { generatedAt: new Date().toISOString(), viewport: VIEW, errors };

  // Regime 1: fast current (default).
  await page.evaluate(() => window.__water.setRegime('current'));
  await sleep(1800);
  report.current = await sampleMetrics(page);
  await page.screenshot({ path: path.join(OUT, mobile ? 'mobile-current.png' : 'water-reflection-current.png') });

  // Regime 2: still water.
  await page.evaluate(() => window.__water.setRegime('calm'));
  await sleep(1800);
  report.calm = await sampleMetrics(page);
  await page.screenshot({ path: path.join(OUT, mobile ? 'mobile-calm.png' : 'water-reflection-calm.png') });

  // Debug variants (desktop only).
  if (!mobile) {
    await page.goto('http://127.0.0.1:8765/index.html?nodistortion', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!(window.__water && window.__water.renderer.stats.frame > 5),
      { timeout: 30000 });
    await sleep(2200);
    await page.screenshot({ path: path.join(OUT, 'water-debug-no-distortion.png') });

    await page.goto('http://127.0.0.1:8765/index.html?noglint', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!(window.__water && window.__water.renderer.stats.frame > 5),
      { timeout: 30000 });
    await sleep(2200);
    await page.screenshot({ path: path.join(OUT, 'water-debug-no-glint.png') });

    await page.goto('http://127.0.0.1:8765/index.html?bodyonly', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!(window.__water && window.__water.renderer.stats.frame > 5),
      { timeout: 30000 });
    await sleep(2200);
    await page.screenshot({ path: path.join(OUT, 'water-debug-body-only.png') });
  }

  await browser.close();
  const file = path.join(OUT, mobile
    ? 'reflection-validation-mobile.json'
    : 'reflection-validation.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('\nReport written to', file);
  if (errors.length) process.exitCode = 2;
})();
