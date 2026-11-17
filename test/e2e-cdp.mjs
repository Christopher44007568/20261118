// 通过 Chrome DevTools Protocol 驱动真实时间的 headless Chrome，
// 运行 ?test 模式并收集三相机的 CPU/GPU 可见集合一致性结果

const BASE = process.env.CDP_URL || 'http://localhost:9222';
const TARGET =
  process.env.TEST_URL ||
  `http://localhost:8124/index.html?test&cb=${Date.now()}`;
const TIMEOUT_MS = 60000;

async function getTargets() {
  const res = await fetch(`${BASE}/json/new?${encodeURIComponent(TARGET)}`, { method: 'PUT' });
  if (!res.ok) {
    const list = await fetch(`${BASE}/json`).then((r) => r.json());
    return list.find((t) => t.type === 'page');
  }
  return res.json();
}

const target = await getTargets();
if (!target?.webSocketDebuggerUrl) throw new Error('未获取到页面 target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('WebSocket 连接失败'));
});

let msgId = 0;
const pending = new Map();
const consoleMessages = [];
const pageErrors = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    consoleMessages.push(text);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    pageErrors.push(
      `${d.text} ${d.exception?.description || ''} @${d.url}:${d.lineNumber}:${d.columnNumber}`
    );
  }
};

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: TARGET });

const deadline = Date.now() + TIMEOUT_MS;
let result = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
  const evalRes = await send('Runtime.evaluate', {
    expression: 'window.__TEST_RESULT__ || null',
    returnByValue: true,
  });
  result = evalRes.result.value;
  if (result) break;
}

const finalDom = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    done: document.body.dataset.testDone,
    candidates: document.getElementById('cpu-candidates').textContent,
    gpu: document.getElementById('gpu-visible').textContent,
    frameMs: document.getElementById('frame-ms').textContent,
    cpuMs: document.getElementById('cpu-ms').textContent,
    camera: document.getElementById('camera-name').textContent,
    fatal: document.getElementById('fatal').textContent,
    gpuErrors: window.__GPU_ERRORS__ || [],
    cpuCandidateSamples: window.__CANDIDATE_SAMPLES__ || {},
  })`,
  returnByValue: true,
});

const hud = JSON.parse(finalDom.result.value);
const candidateDiversity = Object.fromEntries(
  Object.entries(hud.cpuCandidateSamples || {}).map(([k, v]) => [
    k,
    [...new Set(v)].sort((a, b) => a - b),
  ])
);
hud.cpuCandidateSamples = candidateDiversity;
console.log('HUD:', JSON.stringify(hud, null, 2));
console.log('页面异常:', pageErrors.length ? pageErrors : '无');

if (!result) {
  console.error('超时：未拿到 __TEST_RESULT__');
  console.log('最近控制台:', consoleMessages.slice(-10));
  process.exit(1);
}
console.log('测试报告:', JSON.stringify(result, null, 2));
const everyCameraCulls = Object.values(candidateDiversity).every(
  (counts) => counts.length > 0 && counts.every((c) => c < 152)
);
console.log('各相机候选数分布(均应 <152 即发生真实裁剪):', JSON.stringify(candidateDiversity));
ws.close();
process.exit(result.ok && pageErrors.length === 0 && everyCameraCulls ? 0 : 1);
