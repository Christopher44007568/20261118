// 端到端测试：启动静态服务器与 headless Chrome（SwiftShader WebGPU），
// 通过 CDP 驱动 ?test 场景，中途变更 DPR/视口，收集结果并截图

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME =
  process.env.CHROME_PATH ||
  '/home/hj/.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome';
const TIMEOUT_MS = 120000;

const { server, port } = await createStaticServer(0);
const target = `http://127.0.0.1:${port}/index.html?test&cb=${Date.now()}`;

// headless 下 WebGPU 画布呈现需要 Vulkan + SwiftShader ANGLE，
// 否则交换链 SharedImage 创建失败会导致设备被销毁、mapAsync 全部失败
const GPU_FLAGS =
  process.env.CHROME_GPU_FLAGS ||
  '--enable-unsafe-webgpu --enable-features=Vulkan --use-webgpu-adapter=swiftshader --use-angle=swiftshader';
const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  ...GPU_FLAGS.split(' ').filter(Boolean),
  '--window-size=1100,750',
  '--remote-debugging-port=0',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => {
    buf += d.toString();
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on('exit', () => reject(new Error('Chrome 提前退出')));
  setTimeout(() => reject(new Error('等待 DevTools 端口超时')), 20000);
});

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('WebSocket 连接失败'));
});

let msgId = 0;
const pending = new Map();
const consoleLogs = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    consoleLogs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
};

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function evalJs(sessionId, expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
  return res.result?.value;
}

let exitCode = 1;
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: target }, sessionId);

  const deadline = Date.now() + TIMEOUT_MS;
  let result = null;
  let dprApplied = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    const phase = await evalJs(sessionId, 'window.__TEST_PHASE__ || ""');
    if (phase === 'await-dpr' && !dprApplied) {
      dprApplied = true;
      await send('Emulation.setDeviceMetricsOverride',
        { width: 960, height: 680, deviceScaleFactor: 2, mobile: false }, sessionId);
    }
    result = await evalJs(sessionId, 'window.__TEST_RESULT__ || null');
    if (result) break;
  }

  const gpuErrors = await evalJs(sessionId, 'JSON.stringify({pick: window.__PICK_ERRORS__||[], gpu: (window.__GPU_ERRORS__||[]).slice(0,5)})');
  if (gpuErrors && gpuErrors !== '{"pick":[],"gpu":[]}') console.error('页面错误:', gpuErrors);
  if (consoleLogs.length) console.error('控制台:', consoleLogs.slice(-10));

  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const outDir = path.join(ROOT, 'artifacts', 'e2e');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'final.png'), Buffer.from(shot.data, 'base64'));

  if (!result) {
    console.error('超时：未获取到 __TEST_RESULT__');
    console.error('页面日志:', consoleLogs.slice(-20));
  } else {
    console.log(JSON.stringify(result, null, 2));
    if (result.pass) {
      console.log('E2E PASS');
      exitCode = 0;
    } else {
      console.error('E2E FAIL');
    }
  }
} finally {
  chrome.kill('SIGKILL');
  server.close();
}
process.exit(exitCode);
