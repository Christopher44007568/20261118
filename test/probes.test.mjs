import {
  createProbeGrid,
  sampleTet,
  nearestProbe,
  cellProbe,
  applyOcclusion,
  normalizeWeights,
} from '../src/probes.js';

const grid = createProbeGrid({
  nx: 5,
  ny: 3,
  nz: 5,
  origin: [-6, 0.8, -6],
  spacing: [3, 2.2, 3],
});

let failures = 0;
function check(name, cond) {
  if (!cond) {
    failures++;
    console.error('FAIL:', name);
  }
}

// 确定性伪随机
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// 1) 权重归一 + 索引合法（含网格外点，测试钳制）
for (let i = 0; i < 20000; i++) {
  const p = [
    -8 + rand() * 16,
    0 + rand() * 7,
    -8 + rand() * 16,
  ];
  const { indices, weights } = sampleTet(grid, p);
  const sum = weights.reduce((a, b) => a + b, 0);
  check('weights sum to 1', Math.abs(sum - 1) < 1e-9);
  check('weights non-negative', weights.every((w) => w >= -1e-12));
  check(
    'indices valid',
    indices.every((ix) => ix >= 0 && ix < grid.positions.length)
  );
}

// 2) 跨四面体面 / 单元边界连续性：微扰后权重变化应极小（C0 连续）
let maxJump = 0;
for (let i = 0; i < 20000; i++) {
  const p = [-6 + rand() * 12, 0.8 + rand() * 4.4, -6 + rand() * 12];
  const eps = 1e-6;
  const a = sampleTet(grid, p);
  const b = sampleTet(grid, [p[0] + eps, p[1] - eps, p[2] + eps]);
  // 把 b 的权重按探针索引对齐到 a
  const wb = new Map(b.indices.map((ix, k) => [ix, b.weights[k]]));
  for (let k = 0; k < 4; k++) {
    const wa = a.weights[k];
    const w2 = wb.get(a.indices[k]) ?? 0;
    maxJump = Math.max(maxJump, Math.abs(wa - w2));
  }
}
check(`continuous across faces (maxJump=${maxJump})`, maxJump < 1e-4);

// 3) 逐探针 / 最近单探针返回合法索引
for (let i = 0; i < 2000; i++) {
  const p = [-7 + rand() * 14, rand() * 6, -7 + rand() * 14];
  const n = nearestProbe(grid, p);
  const c = cellProbe(grid, p);
  check('nearest valid', n >= 0 && n < grid.positions.length);
  check('cell valid', c >= 0 && c < grid.positions.length);
}

// 4) 遮挡加权后仍归一；全遮挡回退原始权重
for (let i = 0; i < 5000; i++) {
  const w = [rand(), rand(), rand(), rand()];
  const vis = [rand(), rand(), rand(), rand()];
  const out = applyOcclusion(normalizeWeights(w), vis);
  const sum = out.reduce((a, b) => a + b, 0);
  check('occluded weights sum to 1', Math.abs(sum - 1) < 1e-9);
}
{
  const w = normalizeWeights([0.4, 0.3, 0.2, 0.1]);
  const out = applyOcclusion(w, [0, 0, 0, 0]);
  check(
    'all-occluded fallback keeps weights',
    out.every((v, i) => Math.abs(v - w[i]) < 1e-12)
  );
}

// 5) 网格角点处应退化为单探针权重 1
{
  const corner = grid.positions[0];
  const { indices, weights } = sampleTet(grid, corner);
  check('corner picks itself', indices[0] === 0);
  check('corner weight is 1', Math.abs(weights[0] - 1) < 1e-9);
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all probe-math tests passed');
