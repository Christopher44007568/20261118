/* Minimal column-major mat4 / vec3 math, WebGL convention. */
'use strict';

const M4 = {
  identity() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },

  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;
    return m;
  },

  lookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    const m = new Float32Array(16);
    m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
    m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
    m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
    m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    m[15] = 1;
    return m;
  },

  multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] =
          a[0 * 4 + r] * b[c * 4 + 0] +
          a[1 * 4 + r] * b[c * 4 + 1] +
          a[2 * 4 + r] * b[c * 4 + 2] +
          a[3 * 4 + r] * b[c * 4 + 3];
      }
    }
    return out;
  },

  invert(a) {
    const out = new Float32Array(16);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return M4.identity();
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  },

  transpose(a) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) out[r * 4 + c] = a[c * 4 + r];
    return out;
  },

  /* Reflection across the horizontal plane y = height (Eric Lengyel). */
  reflectY(height) {
    const m = M4.identity();
    m[5] = -1;
    m[13] = -2 * height;
    return m;
  },

  transformPoint(m, v) {
    const x = v[0], y = v[1], z = v[2], w = v[3] ?? 1;
    const iw = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15] * w);
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12] * w) * iw,
      (m[1] * x + m[5] * y + m[9] * z + m[13] * w) * iw,
      (m[2] * x + m[6] * y + m[10] * z + m[14] * w) * iw
    ];
  },

  /*
   * Oblique near-plane frustum modification (Lengyel).
   * clipPlane is in eye space; the projection's near plane is moved onto it
   * so geometry below the water is clipped during the mirror pass.
   */
  obliqueNearPlane(proj, clipPlane) {
    /*
     * Lengyel "Oblique View Frustum Clipping" (GDC 2005).
     * The near plane is moved onto clipPlane (eye space) by replacing the
     * THIRD column of the perspective matrix (indices 2,6,10,14).
     */
    const out = new Float32Array(proj);
    // Q = far-frustum corner selected by the signs of the clip-plane components.
    const qx = (Math.sign(clipPlane[0]) + proj[8]) / proj[0];
    const qy = (Math.sign(clipPlane[1]) + proj[9]) / proj[5];
    const qz = -1;
    const qw = (1 + proj[10]) / proj[14];
    const dotQ = clipPlane[0] * qx + clipPlane[1] * qy +
      clipPlane[2] * qz + clipPlane[3] * qw;
    // Third column C3 and fourth column C4 (column-major layout).
    const c3x = proj[2], c3y = proj[6], c3z = proj[10], c3w = proj[14];
    const c4x = proj[3], c4y = proj[7], c4z = proj[11], c4w = proj[15];
    const dotC3 = clipPlane[0] * c3x + clipPlane[1] * c3y +
      clipPlane[2] * c3z + clipPlane[3] * c3w;
    // C'3 = a*C - C4, with a = (C . C3) / (C . Q).
    const s = dotC3 / dotQ;
    out[2] = clipPlane[0] * s - c4x;
    out[6] = clipPlane[1] * s - c4y;
    out[10] = clipPlane[2] * s - c4z;
    out[14] = clipPlane[3] * s - c4w;
    return out;
  }
};
