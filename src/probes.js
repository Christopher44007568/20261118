// 探针体素网格 + 四面体重心插值（纯数学，无 three 依赖，可在 node 中单测）。
//
// 规则网格的每个单元沿主对角线 (0,0,0)->(1,1,1) 劈成 6 个四面体。
// 点 p 落在哪个四面体由局部坐标 (u,v,w) 的大小排序决定，
// 重心权重即排序后坐标的相邻差值。相邻单元共享面的三角剖分一致，
// 因此权重在整个网格上 C0 连续 —— 穿过探针切换面时不会跳变。

export function createProbeGrid({ nx, ny, nz, origin, spacing }) {
  const positions = [];
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        positions.push([
          origin[0] + ix * spacing[0],
          origin[1] + iy * spacing[1],
          origin[2] + iz * spacing[2],
        ]);
      }
    }
  }
  return { nx, ny, nz, origin, spacing, positions };
}

export function probeIndex(grid, ix, iy, iz) {
  return (iz * grid.ny + iy) * grid.nx + ix;
}

function clampCell(v, n) {
  const c = Math.floor(v);
  return Math.min(Math.max(c, 0), n - 2);
}

// 四点四面体插值：返回 { indices: [i0..i3], weights: [w0..w3] }，权重和为 1。
export function sampleTet(grid, p) {
  const { nx, ny, nz, origin, spacing } = grid;
  const fx = (p[0] - origin[0]) / spacing[0];
  const fy = (p[1] - origin[1]) / spacing[1];
  const fz = (p[2] - origin[2]) / spacing[2];
  const cx = clampCell(fx, nx);
  const cy = clampCell(fy, ny);
  const cz = clampCell(fz, nz);
  // 网格外点：单元已钳制，再把局部坐标钳到 [0,1]（钳制连续，不破坏 C0）
  const local = [fx - cx, fy - cy, fz - cz].map((v) =>
    Math.min(Math.max(v, 0), 1)
  );

  // 按局部坐标降序排列轴，确定所在四面体
  const axes = [0, 1, 2].sort((a, b) => local[b] - local[a]);
  const v0 = local[axes[0]];
  const v1 = local[axes[1]];
  const v2 = local[axes[2]];

  const corner = (mask) =>
    probeIndex(grid, cx + mask[0], cy + mask[1], cz + mask[2]);
  const m0 = [0, 0, 0];
  const m1 = [0, 0, 0];
  m1[axes[0]] = 1;
  const m2 = m1.slice();
  m2[axes[1]] = 1;
  const m3 = [1, 1, 1];

  return {
    indices: [corner(m0), corner(m1), corner(m2), corner(m3)],
    weights: [1 - v0, v0 - v1, v1 - v2, v2],
  };
}

// 最近单探针
export function nearestProbe(grid, p) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < grid.positions.length; i++) {
    const q = grid.positions[i];
    const d =
      (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// 逐探针（按所在单元量化，取单元最小角探针）—— 在单元边界硬切换
export function cellProbe(grid, p) {
  const { nx, ny, nz, origin, spacing } = grid;
  const cx = clampCell((p[0] - origin[0]) / spacing[0], nx);
  const cy = clampCell((p[1] - origin[1]) / spacing[1], ny);
  const cz = clampCell((p[2] - origin[2]) / spacing[2], nz);
  return probeIndex(grid, cx, cy, cz);
}

// 遮挡加权并归一化。vis 为每个探针的平滑可见度 (0..1)。
// 全部不可见时回退到原始权重，避免除零。
export function applyOcclusion(weights, vis) {
  const out = weights.map((w, i) => w * vis[i]);
  const sum = out.reduce((a, b) => a + b, 0);
  if (sum < 1e-6) return weights.slice();
  return out.map((w) => w / sum);
}

export function normalizeWeights(weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum < 1e-9) return weights.map(() => 1 / weights.length);
  return weights.map((w) => w / sum);
}
