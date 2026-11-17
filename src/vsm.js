// Software rasterizer + Variance Shadow Map (first/second depth moments).
"use strict";
const { m4 } = require("./math");

const W_EPS = 1e-6;

// Clip a homogeneous polygon against the near plane (w > W_EPS).
// verts: array of { c: [x,y,z,w], a: [attr...] } — attrs linear in clip space.
function clipNear(verts) {
  const out = [];
  for (let i = 0; i < verts.length; i++) {
    const cur = verts[i], prev = verts[(i + verts.length - 1) % verts.length];
    const curIn = cur.c[3] > W_EPS, prevIn = prev.c[3] > W_EPS;
    if (curIn !== prevIn) {
      const t = (W_EPS - prev.c[3]) / (cur.c[3] - prev.c[3]);
      const c = cur.c.map((v, k) => prev.c[k] + t * (v - prev.c[k]));
      const a = cur.a.map((v, k) => prev.a[k] + t * (v - prev.a[k]));
      out.push({ c, a });
    }
    if (curIn) out.push(cur);
  }
  return out;
}

// Rasterize meshes. viewProj transforms world -> clip.
// mode "camera": fills zbuf, worldPos (3/px), normal (3/px), meshId (1/px)
// mode "depth":  fills zbuf with linear view-space depth only
function rasterize(meshes, viewProj, view, width, height, mode) {
  const npix = width * height;
  const zbuf = new Float64Array(npix).fill(Infinity);
  const isCam = mode === "camera";
  const worldPos = isCam ? new Float32Array(npix * 3) : null;
  const normals = isCam ? new Float32Array(npix * 3) : null;
  const meshId = isCam ? new Int16Array(npix).fill(-1) : null;

  for (let mi = 0; mi < meshes.length; mi++) {
    const tris = meshes[mi].tris;
    for (let t = 0; t < tris.length; t += 9) {
      const P = [
        [tris[t], tris[t + 1], tris[t + 2]],
        [tris[t + 3], tris[t + 4], tris[t + 5]],
        [tris[t + 6], tris[t + 7], tris[t + 8]],
      ];
      const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
      const e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      let n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / nl, n[1] / nl, n[2] / nl];

      // Homogeneous verts; attrs = world pos (3) + view-space linear depth (1).
      let poly = P.map((p) => ({
        c: m4.transformPoint(viewProj, p),
        a: [p[0], p[1], p[2], -m4.transformPoint(view, p)[2]],
      }));
      poly = clipNear(poly);
      if (poly.length < 3) continue;

      // Fan-triangulate the clipped polygon.
      for (let k = 1; k + 1 < poly.length; k++) {
        rasterTri([poly[0], poly[k], poly[k + 1]], n, mi);
      }
    }
  }

  function rasterTri(verts, n, mi) {
    const scr = verts.map((v) => [
      (v.c[0] / v.c[3] * 0.5 + 0.5) * width,
      (1 - (v.c[1] / v.c[3] * 0.5 + 0.5)) * height,
      v.c[2] / v.c[3] * 0.5 + 0.5,
      1 / v.c[3],
    ]);
    const minX = Math.max(0, Math.floor(Math.min(scr[0][0], scr[1][0], scr[2][0])));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(scr[0][0], scr[1][0], scr[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(scr[0][1], scr[1][1], scr[2][1])));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(scr[0][1], scr[1][1], scr[2][1])));
    if (minX > maxX || minY > maxY) return;
    const [x0, y0] = scr[0], [x1, y1] = scr[1], [x2, y2] = scr[2];
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-12) return;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den;
        const w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * scr[0][2] + w1 * scr[1][2] + w2 * scr[2][2];
        const idx = y * width + x;
        if (z >= zbuf[idx]) continue;
        // Perspective-correct attribute interpolation.
        const c0 = w0 * scr[0][3], c1 = w1 * scr[1][3], c2 = w2 * scr[2][3];
        const inv = 1 / (c0 + c1 + c2);
        const a0 = verts[0].a, a1 = verts[1].a, a2 = verts[2].a;
        const attr = (j) => (c0 * a0[j] + c1 * a1[j] + c2 * a2[j]) * inv;
        if (isCam) {
          zbuf[idx] = z;
          worldPos[idx * 3] = attr(0);
          worldPos[idx * 3 + 1] = attr(1);
          worldPos[idx * 3 + 2] = attr(2);
          normals[idx * 3] = n[0]; normals[idx * 3 + 1] = n[1]; normals[idx * 3 + 2] = n[2];
          meshId[idx] = mi;
        } else {
          zbuf[idx] = attr(3); // linear view depth
        }
      }
    }
  }

  return { zbuf, worldPos, normals, meshId };
}

// Depth-moment texture: RG32F analog, M1 = depth, M2 = depth^2.
// Marked dirty when any caster moves; update() re-renders the shadow pass.
class MomentTexture {
  constructor(light, size) {
    this.light = light;   // { view, proj }
    this.size = size;
    this.moments = new Float32Array(size * size * 2);
    this.depth = new Float32Array(size * size); // raw depth for hard/PCF paths
    this.dirty = true;
    this.updateCount = 0;
  }
  invalidate() { this.dirty = true; }
  update(meshes) {
    if (!this.dirty) return false;
    const { zbuf } = rasterize(meshes, m4.multiply(this.light.proj, this.light.view),
      this.light.view, this.size, this.size, "depth");
    for (let i = 0; i < zbuf.length; i++) {
      const d = zbuf[i] === Infinity ? 1e9 : zbuf[i];
      this.depth[i] = d;
      this.moments[i * 2] = d;
      this.moments[i * 2 + 1] = d * d;
    }
    this.dirty = false;
    this.updateCount++;
    return true;
  }
  // Separable Gaussian blur of the two moment channels (softens VSM penumbra).
  blur(sigma) {
    const r = Math.max(1, Math.ceil(sigma * 3));
    const k = [];
    let sum = 0;
    for (let i = -r; i <= r; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(w); sum += w; }
    const s = this.size, tmp = new Float32Array(this.moments.length);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        let m1 = 0, m2 = 0;
        for (let i = -r; i <= r; i++) {
          const xx = Math.min(s - 1, Math.max(0, x + i));
          const j = (y * s + xx) * 2, w = k[i + r];
          m1 += this.moments[j] * w; m2 += this.moments[j + 1] * w;
        }
        tmp[(y * s + x) * 2] = m1 / sum; tmp[(y * s + x) * 2 + 1] = m2 / sum;
      }
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        let m1 = 0, m2 = 0;
        for (let i = -r; i <= r; i++) {
          const yy = Math.min(s - 1, Math.max(0, y + i));
          const j = (yy * s + x) * 2, w = k[i + r];
          m1 += tmp[j] * w; m2 += tmp[j + 1] * w;
        }
        this.moments[(y * s + x) * 2] = m1 / sum; this.moments[(y * s + x) * 2 + 1] = m2 / sum;
      }
  }
  sampleMoments(u, v) {
    const s = this.size;
    const x = Math.min(s - 1, Math.max(0, Math.round(u * s - 0.5)));
    const y = Math.min(s - 1, Math.max(0, Math.round(v * s - 0.5)));
    const i = (y * s + x) * 2;
    return [this.moments[i], this.moments[i + 1]];
  }
  sampleDepth(u, v) {
    const s = this.size;
    const x = Math.min(s - 1, Math.max(0, Math.round(u * s - 0.5)));
    const y = Math.min(s - 1, Math.max(0, Math.round(v * s - 0.5)));
    return this.depth[y * s + x];
  }
}

// Chebyshev upper bound on visibility from the two moments.
function chebyshev(m1, m2, t, minVariance) {
  if (t <= m1) return 1.0;
  let variance = m2 - m1 * m1;
  variance = Math.max(variance, minVariance);
  const d = t - m1;
  return variance / (variance + d * d);
}

// Adjustable light-bleeding suppression: remap [amount,1] -> [0,1].
function reduceLightBleeding(p, amount) {
  return Math.min(1, Math.max(0, (p - amount) / (1 - amount)));
}

module.exports = { rasterize, MomentTexture, chebyshev, reduceLightBleeding };
