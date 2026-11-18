import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(import.meta.dirname, '..');
const ARTIFACTS = path.join(ROOT, 'artifacts');
mkdirSync(ARTIFACTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: path.join(ROOT, '.browser/chrome-linux64/chrome'),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

const page = await browser.newPage();
await page.setViewport({ width: 800, height: 600 });
page.on('pageerror', (e) => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });

async function load(scene) {
  await page.goto(`${base}/index.html?test=1&scene=${scene}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__app !== undefined');
}
const app = (expr) => page.evaluate(expr);
async function shot(name) {
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`) });
}

// ---- scenario 1: two objects far apart -------------------------------------
await load('apart');
let s = await app('__app.edgeStats()');
check('apart: edges detected', s.count > 500, `edge pixels=${s.count}`);
check('apart: both objects outlined', s.leftCount > 100 && s.rightCount > 100,
  `left=${s.leftCount} right=${s.rightCount}`);
await app('__app.setMode(0)'); await shot('apart-composite');
await app('__app.setMode(1)'); await shot('apart-scene-only');
await app('__app.setMode(2)'); await shot('apart-outline-only');

// ---- texture edges must not become outlines --------------------------------
const hashTextured = (await app('__app.edgeStats()')).hash;
await app('__app.setTextured(false)');
const hashPlain = (await app('__app.edgeStats()')).hash;
await app('__app.setTextured(true)');
check('texture-invariance: interior texture edges not outlined',
  hashTextured === hashPlain, `hash textured=${hashTextured} plain=${hashPlain}`);

// ---- scenario 2: objects hugging a surface ---------------------------------
await load('contact');
s = await app('__app.edgeStats()');
check('contact: silhouette edges detected', s.count > 300, `edge pixels=${s.count}`);
// open ground area (bottom-centre of the frame) must stay edge-free
const groundEdges = await app('__app.edgeCountInRect(0.4, 0.05, 0.6, 0.25)');
check('contact: flat ground interior has no edges', groundEdges === 0,
  `ground region edge pixels=${groundEdges}`);
await app('__app.setMode(0)'); await shot('contact-composite');
await app('__app.setMode(2)'); await shot('contact-outline-only');

// ---- scenario 3: occlusion boundary ----------------------------------------
await load('occlusion');
s = await app('__app.edgeStats()');
check('occlusion: junction outlined', s.count > 300, `edge pixels=${s.count}`);
await app('__app.setMode(0)'); await shot('occlusion-composite');
await app('__app.setMode(2)'); await shot('occlusion-outline-only');

// ---- line width stability under viewport scaling ---------------------------
await load('apart');
await app('__app.setSize(320, 240)');
const small = await app('__app.edgeStats()');
await app('__app.setSize(1280, 960)');
const large = await app('__app.edgeStats()');
check('line width stable: small viewport',
  small.p99 <= 3 && small.maxThickness <= 4,
  `p50=${small.p50} p99=${small.p99} max=${small.maxThickness}px @320x240`);
check('line width stable: large viewport',
  large.p99 <= 3 && large.maxThickness <= 4,
  `p50=${large.p50} p99=${large.p99} max=${large.maxThickness}px @1280x960`);
check('line width identical across viewports',
  small.p50 === large.p50 && Math.abs(small.p99 - large.p99) <= 1,
  `p50 ${small.p50}px vs ${large.p50}px, p99 ${small.p99}px vs ${large.p99}px`);
const ratio = large.count / small.count;
check('edge length scales with resolution (not width)', ratio > 2.5 && ratio < 6,
  `count ratio=${ratio.toFixed(2)} (expect ~4 for 4x linear size)`);
await app('__app.setSize(800, 600)');

// ---- flicker: static camera must be bit-identical --------------------------
await load('apart');
const hashes = [];
for (let i = 0; i < 5; i++) {
  await app('__app.renderFrame()');
  hashes.push((await app('__app.edgeStats()')).hash);
}
check('no flicker: static frames identical', new Set(hashes).size === 1,
  `hashes=${hashes.join(',')}`);

// ---- flicker: moving camera, edge count must evolve smoothly ---------------
const counts = [];
for (let i = 0; i < 20; i++) {
  const a = i * 0.02;
  await app(`__app.setCamera(${30 * Math.sin(a)}, 8, ${30 * Math.cos(a)}, 0, 2, -5)`);
  counts.push((await app('__app.edgeStats()')).count);
}
let maxJump = 0;
for (let i = 1; i < counts.length; i++)
  maxJump = Math.max(maxJump, Math.abs(counts[i] - counts[i - 1]) / counts[i - 1]);
check('no flicker: smooth count under camera motion', maxJump < 0.1,
  `max frame-to-frame change=${(maxJump * 100).toFixed(2)}%  counts=[${counts.join(',')}]`);

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
writeFileSync(path.join(ARTIFACTS, 'test-results.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
