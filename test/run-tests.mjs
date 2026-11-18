// Headless-Chrome test driver for the depth-reprojection motion blur demo.
// Serves the repo over HTTP, drives the page via CDP (no npm deps),
// collects per-scenario metrics + debug screenshots, asserts expectations.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'artifacts');
const CHROME = process.env.CHROME ||
  '/tmp/chrome-hs/chrome-headless-shell-linux64/chrome-headless-shell';
const VIEWPORT = [1280, 720];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png' };

function serve() {
  const srv = http.createServer(async (req, res) => {
    const p = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url));
    try {
      const data = await readFile(p);
      res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('nf');
    }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

function launchChrome() {
  const args = ['--remote-debugging-port=0', '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader', `--window-size=${VIEWPORT[0]},${VIEWPORT[1]}`,
    '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve({ proc, wsUrl: m[1] });
    });
    proc.on('exit', () => reject(new Error('chrome exited\n' + buf)));
    setTimeout(() => reject(new Error('chrome ws timeout\n' + buf)), 15000);
  });
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const c = new Cdp(ws);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && c.pending.has(m.id)) {
        const { res, rej } = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) c.events.push(m);
    };
    return c;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }
}

async function main() {
  await mkdir(ART, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const { proc, wsUrl } = await launchChrome();
  const out = { testedAt: new Date().toISOString(), chrome: CHROME, viewport: VIEWPORT,
    renderResolution: [960, 540], scenarios: {}, screenshots: {}, checks: [] };
  const check = (name, ok, detail) => {
    out.checks.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  };
  try {
    const cdp = await Cdp.connect(wsUrl);
    const { targetId } = await cdp.send('Target.createTarget',
      { url: `http://127.0.0.1:${port}/index.html` });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const S = sessionId;
    await cdp.send('Page.enable', {}, S);
    await cdp.send('Runtime.enable', {}, S);
    const evalJs = async (expr) => {
      const r = await cdp.send('Runtime.evaluate',
        { expression: expr, returnByValue: true, awaitPromise: true }, S);
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    for (let i = 0; i < 100; i++) {
      if (await evalJs('!!(window.__mb && window.__mb.ready)')) break;
      await new Promise((r) => setTimeout(r, 100));
      if (i === 99) throw new Error('page never became ready');
    }
    await evalJs('__mb.pause(true)');
    const shot = async (file, clip) => {
      const p = { format: 'png' };
      if (clip) p.clip = { ...clip, scale: 1 };
      const r = await cdp.send('Page.captureScreenshot', p, S);
      await writeFile(path.join(ART, file), Buffer.from(r.data, 'base64'));
      out.screenshots[file.replace('.png', '').replace(/[^a-z0-9]/gi, '')] =
        { file, bytes: Buffer.byteLength(r.data, 'base64') };
    };

    const FRAMES = { static: 12, pan: 22, fan: 32 };
    for (const sc of ['static', 'pan', 'fan']) {
      await evalJs(`__mb.setScenario('${sc}')`);
      await evalJs(`__mb.step(${FRAMES[sc]})`);
      const stats = await evalJs('__mb.stats()');
      out.scenarios[sc] = stats;
      await evalJs(`__mb.setView('composite')`);
      await evalJs('__mb.step(1)');
      await shot(`scene-${sc === 'pan' ? 'fast-pan' : sc === 'fan' ? 'spinning-fan' : 'static'}.png`);
      const fp = await evalJs('__mb.fanScreenPos()');
      if (sc !== 'static') {
        await shot(`detail-${sc === 'pan' ? 'fast-pan' : 'spinning-fan'}.png`,
          { x: Math.max(0, fp.x - 180), y: Math.max(0, fp.y - 135), width: 360, height: 270 });
      }
    }

    // debug views captured on the spinning-fan scenario
    await evalJs(`__mb.setScenario('fan')`);
    await evalJs('__mb.step(20)');
    for (const [view, file] of [['velocity', 'debug-velocity.png'],
      ['blur', 'debug-blur-buffer.png'], ['history', 'debug-history-weight.png'],
      ['split', 'debug-motion-split.png']]) {
      await evalJs(`__mb.setView('${view}')`);
      await evalJs('__mb.step(1)');
      await shot(file);
    }
    await evalJs(`__mb.setView('composite')`);

    out.hud = await evalJs('__mb.hudInfo()');
    const iso = await evalJs('__mb.canvasHudIsolation()');
    out.hudIsolation = iso;

    const st = out.scenarios.static, pa = out.scenarios.pan, fa = out.scenarios.fan;
    check('static: no motion', st.total.averagePx < 0.05,
      `avg ${st.total.averagePx.toFixed(4)} px`);
    check('static: no object motion', st.object.pixelCount === 0);
    check('static: blur range never shortened', st.blurRange.shortenedFraction === 0);
    check('static: history weight high', st.history.average > 0.8,
      `avg ${st.history.average.toFixed(3)}`);
    check('pan: camera motion detected', pa.camera.averagePx > 1,
      `avg ${pa.camera.averagePx.toFixed(2)} px`);
    check('pan: no object motion', pa.object.averagePx < 0.01,
      `avg ${pa.object.averagePx.toFixed(4)} px`);
    check('pan: occlusion shortens blur range', pa.blurRange.shortenedFraction > 0,
      `${(pa.blurRange.shortenedFraction * 100).toFixed(2)}% pixels`);
    check('fan: object motion on blades', fa.fan.objectAveragePx > 2,
      `avg ${fa.fan.objectAveragePx.toFixed(2)} px on ${fa.fan.pixelCount} px`);
    check('fan: camera static', fa.camera.averagePx < 0.05,
      `avg ${fa.camera.averagePx.toFixed(4)} px`);
    check('fan: static background has no trail', fa.background.averagePx < 0.05,
      `avg ${fa.background.averagePx.toFixed(4)} px`);
    check('fan: object pixels counted', fa.fanObjectPixelCount > 1000,
      `${fa.fanObjectPixelCount} px`);
    check('hud: DOM overlay sibling of canvas',
      out.hud.element === 'SECTION' && out.hud.canvasSibling === true);
    check('hud: not blurred with scene', iso.identical === true,
      `${iso.differingBytes} differing bytes`);

    await writeFile(path.join(ART, 'test-results.json'), JSON.stringify(out, null, 2));
    const failed = out.checks.filter((c) => !c.ok).length;
    console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
    proc.kill(); srv.close();
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error('driver error:', e.message);
    proc.kill(); srv.close();
    process.exit(2);
  }
}
main();
