// Column-major 4x4 matrix helpers (Float32Array length 16).

export function identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function lookAt(eye, center, up) {
  const [ex, ey, ez] = eye;
  let zx = ex - center[0], zy = ey - center[1], zz = ez - center[2];
  let len = Math.hypot(zx, zy, zz);
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * ex + xy * ey + xz * ez);
  m[13] = -(yx * ex + yy * ey + yz * ez);
  m[14] = -(zx * ex + zy * ey + zz * ez);
  m[15] = 1;
  return m;
}

export function translation(x, y, z) {
  const m = identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function rotationY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = identity();
  m[0] = c; m[2] = -s;
  m[8] = s; m[10] = c;
  return m;
}

export function rotationX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = identity();
  m[5] = c; m[6] = s;
  m[9] = -s; m[11] = c;
  return m;
}

export function scaling(x, y, z) {
  const m = identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}

export function compose(pos, rotY, scale) {
  let m = multiply(translation(pos[0], pos[1], pos[2]), rotationY(rotY));
  m = multiply(m, scaling(scale[0], scale[1], scale[2]));
  return m;
}

export function normalMatrix(model) {
  // Inverse-transpose of upper 3x3; uniform scale makes this proportional to
  // model 3x3, but we compute the inverse properly for correctness.
  const a = model[0], b = model[4], c = model[8];
  const d = model[1], e = model[5], f = model[9];
  const g = model[2], h = model[6], i = model[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const inv = 1 / det;
  const n = new Float32Array(9);
  n[0] = (e * i - f * h) * inv;
  n[1] = (c * h - b * i) * inv;
  n[2] = (b * f - c * e) * inv;
  n[3] = (f * g - d * i) * inv;
  n[4] = (a * i - c * g) * inv;
  n[5] = (c * d - a * f) * inv;
  n[6] = (d * h - e * g) * inv;
  n[7] = (b * g - a * h) * inv;
  n[8] = (a * e - b * d) * inv;
  return n; // transpose of cofactor-inverse = inverse-transpose
}
