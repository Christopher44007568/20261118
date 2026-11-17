// 通过 CDP 截取三个相机的画面到 artifacts/，用于人工核对渲染与深度遮挡
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.CDP_URL || 'http://localhost:9222';
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'artifacts');

const target = await fetch(`${BASE}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => (ws.onopen = res));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

for (let cam = 0; cam < 3; cam++) {
  await send('Page.navigate', { url: `http://localhost:8124/index.html?cam=${cam}` });
  // 等待渲染若干帧
  await new Promise((r) => setTimeout(r, 2500));
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-camera="${cam}"]').click(); true`,
  });
  await new Promise((r) => setTimeout(r, 1200));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, `camera-${cam}.png`), Buffer.from(shot.data, 'base64'));
  console.log('saved', `artifacts/camera-${cam}.png`);
}
ws.close();
