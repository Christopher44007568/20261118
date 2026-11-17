// f32 数学库：所有运算经过 Math.fround，保证与 WGSL f32 逐运算一致
// 矩阵为列主序（与 GPU 端 mat4x4<f32> 内存布局相同）

export const f32 = Math.fround;

export function perspective(fovYRad, aspect, near, far) {
  const f = f32(1 / Math.tan(fovYRad / 2));
  const nf = f32(1 / f32(near - far));
  const m = new Float32Array(16);
  m[0] = f32(f / aspect);
  m[5] = f;
  m[10] = f32(far * nf);
  m[11] = -1;
  m[14] = f32(f32(2 * far) * f32(near * nf));
  return m;
}

export function lookAt(eye, center, up) {
  const sub = (a, b, i) => f32(a[i] - b[i]);
  let zx = sub(eye, center, 0), zy = sub(eye, center, 1), zz = sub(eye, center, 2);
  let len = f32(Math.hypot(zx, zy, zz));
  zx = f32(zx / len); zy = f32(zy / len); zz = f32(zz / len);

  let xx = f32(up[1] * zz - up[2] * zy);
  let xy = f32(up[2] * zx - up[0] * zz);
  let xz = f32(up[0] * zy - up[1] * zx);
  len = f32(Math.hypot(xx, xy, xz));
  xx = f32(xx / len); xy = f32(xy / len); xz = f32(xz / len);

  const yx = f32(zy * xz - zz * xy);
  const yy = f32(zz * xx - zx * xz);
  const yz = f32(zx * xy - zy * xx);

  const m = new Float32Array(16);
  m[0] = xx; m[4] = xy; m[8] = xz;
  m[1] = yx; m[5] = yy; m[9] = yz;
  m[2] = zx; m[6] = zy; m[10] = zz;
  m[12] = f32(-(xx * eye[0] + xy * eye[1] + xz * eye[2]));
  m[13] = f32(-(yx * eye[0] + yy * eye[1] + yz * eye[2]));
  m[14] = f32(-(zx * eye[0] + zy * eye[1] + zz * eye[2]));
  m[15] = 1;
  return m;
}

export function mulMat4(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      const s = f32(
        f32(a[row] * b[col * 4]) +
        f32(a[4 + row] * b[col * 4 + 1]) +
        f32(a[8 + row] * b[col * 4 + 2]) +
        f32(a[12 + row] * b[col * 4 + 3])
      );
      out[col * 4 + row] = s;
    }
  }
  return out;
}

// 从列主序 view-projection 矩阵提取 6 个视锥平面（Gribb-Hartmann）
// 行 r 列 c 的元素为 m[c*4+r]
export function extractFrustumPlanes(m) {
  const raw = [
    [f32(m[3] + m[0]), f32(m[7] + m[4]), f32(m[11] + m[8]),  f32(m[15] + m[12])],  // left
    [f32(m[3] - m[0]), f32(m[7] - m[4]), f32(m[11] - m[8]),  f32(m[15] - m[12])],  // right
    [f32(m[3] + m[1]), f32(m[7] + m[5]), f32(m[11] + m[9]),  f32(m[15] + m[13])],  // bottom
    [f32(m[3] - m[1]), f32(m[7] - m[5]), f32(m[11] - m[9]),  f32(m[15] - m[13])],  // top
    [f32(m[3] + m[2]), f32(m[7] + m[6]), f32(m[11] + m[10]), f32(m[15] + m[14])],  // near
    [f32(m[3] - m[2]), f32(m[7] - m[6]), f32(m[11] - m[10]), f32(m[15] - m[14])],  // far
  ];
  return raw.map((p) => {
    const len = f32(Math.hypot(p[0], p[1], p[2]));
    return [f32(p[0] / len), f32(p[1] / len), f32(p[2] / len), f32(p[3] / len)];
  });
}

// 与 WGSL 端 aabbInFrustum 完全对应的 f32 实现
export function aabbInFrustum(center, half, planes) {
  for (let i = 0; i < 6; i++) {
    const p = planes[i];
    const px = f32(p[0] * f32(center[0] + (p[0] > 0 ? half[0] : -half[0])));
    const py = f32(p[1] * f32(center[1] + (p[1] > 0 ? half[1] : -half[1])));
    const pz = f32(p[2] * f32(center[2] + (p[2] > 0 ? half[2] : -half[2])));
    if (f32(f32(f32(px + py) + pz) + p[3]) < 0) return false;
  }
  return true;
}

export function rotationY(angle) {
  const c = f32(Math.cos(angle)), s = f32(Math.sin(angle));
  const m = new Float32Array(16);
  m[0] = c;  m[2] = s;
  m[8] = f32(-s); m[10] = c;
  m[5] = 1; m[15] = 1;
  return m;
}

export function translation(x, y, z) {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  m[12] = f32(x); m[13] = f32(y); m[14] = f32(z);
  return m;
}

// T * R，旋转后平移，全部 f32 运算
export function composeTR(angle, x, y, z) {
  const r = rotationY(angle);
  const t = translation(x, y, z);
  return mulMat4(t, r);
}

// 用模型矩阵变换局部 8 角点，返回世界 AABB {min,max,center,half}
export function transformAABB(localMin, localMax, model) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? localMax[0] : localMin[0];
    const ly = i & 2 ? localMax[1] : localMin[1];
    const lz = i & 4 ? localMax[2] : localMin[2];
    for (let row = 0; row < 3; row++) {
      const wx = f32(
        f32(model[row] * lx) +
        f32(model[4 + row] * ly) +
        f32(model[8 + row] * lz) +
        model[12 + row]
      );
      if (wx < mn[row]) mn[row] = wx;
      if (wx > mx[row]) mx[row] = wx;
    }
  }
  const center = [0, 0, 0], half = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    center[k] = f32((mn[k] + mx[k]) / 2);
    half[k] = f32((mx[k] - mn[k]) / 2);
  }
  return { min: mn, max: mx, center, half };
}
