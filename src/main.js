import {
  makeLargePlane, makeSmallCube, makeSlivers, makeUvSeamQuad, makeSphere,
} from './mesh.js';
import { startDemo } from './app.js';

const meshes = [
  makeLargePlane(), makeSmallCube(), makeSlivers(), makeSphere(), makeUvSeamQuad(),
];

const canvas = document.getElementById('gl');
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
}
resize();
window.addEventListener('resize', resize);

const demo = startDemo(canvas, meshes, { mode: 'oct16' });

const meshSel = document.getElementById('mesh');
meshes.forEach((m, i) => {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = m.name;
  meshSel.appendChild(opt);
});
const octSel = document.getElementById('oct');
const statsEl = document.getElementById('stats');
const bytesEl = document.getElementById('bytes');
const checksEl = document.getElementById('checks');
const rightLabel = document.getElementById('rightLabel');

function sci(x, d = 3) {
  if (x === 0) return '0';
  return Math.abs(x) < 1e-3 || Math.abs(x) >= 1e4
    ? x.toExponential(d) : x.toFixed(d);
}

function refreshStats() {
  const s = demo.getState();
  const st = s.stats;
  statsEl.innerHTML = `
    <tr><th>指标</th><th>最大误差</th></tr>
    <tr><td>位置 绝对</td><td>${sci(st.position.maxAbs)}</td></tr>
    <tr><td>位置 相对/对角</td><td>${sci(st.position.maxRelative)}</td></tr>
    <tr><td>UV</td><td>${sci(st.uv.maxAbs)}</td></tr>
    <tr><td>法线角度</td><td>${st.normal.maxAngleDeg.toFixed(4)}°</td></tr>
    <tr><td>法线单位长度</td><td>${sci(st.normal.maxLengthError)}</td></tr>
    <tr><td>切线角度*</td><td>${st.tangent.maxAngleDeg.toFixed(2)}°</td></tr>
    <tr><td>切线单位长度</td><td>${sci(st.tangent.maxLengthError)}</td></tr>
    <tr><td>RGB 色差</td><td>${sci(st.color.maxRgbDistance)}</td></tr>`;
  const b = s.bytes;
  bytesEl.innerHTML = `
    <tr><th></th><th>每顶点</th><th>总计</th></tr>
    <tr><td>原始 float32</td><td>${b.source / st.vertexCount} B</td><td>${b.source} B</td></tr>
    <tr><td>压缩 ${s.mode}</td><td>${s.packed.stride} B</td><td>${b.compressed} B</td></tr>
    <tr><td>压缩比</td><td colspan="2" class="ok">${(b.source / b.compressed).toFixed(2)}×</td></tr>`;
  const aabbOk = st.aabb.inside;
  const frameOk = st.frameOrthonormalError <= 1e-5;
  const handOk = st.tangent.handednessMismatches === 0;
  const nrmOk = st.normal.maxLengthError <= (s.mode === 'oct16' ? 0.02 : 1e-3);
  const mark = (ok) => ok ? '<span class="ok">通过</span>' : '<span class="bad">失败</span>';
  checksEl.innerHTML = `
    <tr><td>包围盒不越界</td><td>${mark(aabbOk)}</td></tr>
    <tr><td>法线单位长度可控</td><td>${mark(nrmOk)}</td></tr>
    <tr><td>切线帧正交</td><td>${mark(frameOk)}</td></tr>
    <tr><td>切线手性保留</td><td>${mark(handOk)}</td></tr>
    <tr><td>正交误差</td><td>${sci(st.frameOrthonormalError)}</td></tr>`;
}

meshSel.addEventListener('change', () => {
  demo.setMesh(Number(meshSel.value));
  refreshStats();
});
octSel.addEventListener('change', () => {
  demo.setMode(octSel.value);
  refreshStats();
});
document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const v = Number(btn.dataset.view);
    demo.setViewMode(v);
    demo.setHeatMetric(v === 2 ? 1 : 0);
    rightLabel.textContent =
      v === 0 ? '还原（压缩缓冲）' : v === 1 ? '法线角误差热图' : '色差热图';
  });
});

let dragging = false, last = null;
canvas.addEventListener('pointerdown', (e) => { dragging = true; last = [e.clientX, e.clientY]; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  demo.rotate((e.clientX - last[0]) * 0.01, (e.clientY - last[1]) * 0.01);
  last = [e.clientX, e.clientY];
});

refreshStats();
