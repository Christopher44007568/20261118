// 列主序 4x4 矩阵与射线工具，供相机、实例变换与 CPU 拾取共用

export function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

// WebGPU 深度范围 [0, 1] 的透视投影
export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

export function mat4LookAt(eye, target, up) {
  const z = normalize3(sub3(eye, target));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  const m = mat4Identity();
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
  m[12] = -dot3(x, eye);
  m[13] = -dot3(y, eye);
  m[14] = -dot3(z, eye);
  return m;
}

// 由平移 / 旋转(Y 轴) / 均匀缩放组合实例模型矩阵
export function mat4Compose(tx, ty, tz, rotY, scale) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const m = mat4Identity();
  m[0] = c * scale; m[1] = 0; m[2] = -s * scale;
  m[4] = 0; m[5] = scale; m[6] = 0;
  m[8] = s * scale; m[9] = 0; m[10] = c * scale;
  m[12] = tx; m[13] = ty; m[14] = tz;
  return m;
}

// 通用 4x4 求逆（高斯-约当），用于反投影与实例局部空间变换。
// 列主序平坦数组直接按行主序解读等价于转置；而 (M^T)^-1 = (M^-1)^T，
// 其行主序平坦表示正好等于 M^-1 的列主序表示，因此结果无需再转置。
export function mat4Invert(src) {
  const a = Array.from(src);
  const inv = Array.from(mat4Identity());
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let r = col + 1; r < 4; r++) {
      if (Math.abs(a[r * 4 + col]) > Math.abs(a[pivot * 4 + col])) pivot = r;
    }
    if (pivot !== col) {
      for (let k = 0; k < 4; k++) {
        [a[col * 4 + k], a[pivot * 4 + k]] = [a[pivot * 4 + k], a[col * 4 + k]];
        [inv[col * 4 + k], inv[pivot * 4 + k]] = [inv[pivot * 4 + k], inv[col * 4 + k]];
      }
    }
    const d = a[col * 4 + col];
    if (Math.abs(d) < 1e-12) return null;
    for (let k = 0; k < 4; k++) {
      a[col * 4 + k] /= d;
      inv[col * 4 + k] /= d;
    }
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = a[r * 4 + col];
      for (let k = 0; k < 4; k++) {
        a[r * 4 + k] -= f * a[col * 4 + k];
        inv[r * 4 + k] -= f * inv[col * 4 + k];
      }
    }
  }
  return Float32Array.from(inv);
}

export function transformPoint(m, p) {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

export function transformDir(m, d) {
  const [x, y, z] = d;
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
}

export function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
