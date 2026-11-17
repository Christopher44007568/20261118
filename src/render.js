// Shading: directional light + one spotlight, three shadow paths + reference.
"use strict";
const { v3, m4 } = require("./math");
const { chebyshev, reduceLightBleeding } = require("./vsm");

// Deterministic 8x8 stratified disk offsets for the reference PCF.
const POISSON64 = (() => {
  const pts = [];
  const N = 8;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N;
      const r = Math.sqrt(u), a = 2 * Math.PI * v;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  return pts;
})();

function makeLights() {
  // Directional "sun".
  const sunDir = v3.normalize([0.55, -1.0, 0.35]); // shadows fall toward the camera
  const sunEye = v3.scale(sunDir, -18);
  const sun = {
    type: "directional",
    dir: sunDir,
    color: [1.0, 0.96, 0.88],
    intensity: 1.0,
    view: m4.lookAt(sunEye, [0, 0, 0], [0, 1, 0]),
    proj: m4.ortho(-8, 8, -8, 8, 0.1, 40),
    baseBias: 0.06, // large ortho texels (~3cm) need a larger depth bias
  };
  // One spotlight aimed at the slab/cube area.
  const spotPos = [6.0, 1.8, 1.4];
  const spotTarget = [1.2, 0.1, 1.3];
  const spot = {
    type: "spot",
    pos: spotPos,
    dir: v3.normalize(v3.sub(spotTarget, spotPos)),
    cosOuter: Math.cos((26 * Math.PI) / 180),
    cosInner: Math.cos((18 * Math.PI) / 180),
    color: [0.85, 0.9, 1.0],
    intensity: 1.8,
    view: m4.lookAt(spotPos, spotTarget, [0, 1, 0]),
    proj: m4.perspective((52 * Math.PI) / 180, 1, 0.5, 30),
    baseBias: 0.03, // grazing incidence -> larger per-texel depth slope
  };
  return [sun, spot];
}

// Project world position into light UV + linear depth t. Returns null if outside.
function projectToLight(light, p) {
  const c = m4.transformPoint(m4.multiply(light.proj, light.view), p);
  if (c[3] <= 0) return null;
  const u = c[0] / c[3] * 0.5 + 0.5;
  const v = 0.5 - c[1] / c[3] * 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const t = -m4.transformPoint(light.view, p)[2];
  return { u, v, t };
}

// Shadow visibility per mode. params carries bias / minVariance / bleeding.
function visibility(mode, mt, light, p, params) {
  const s = projectToLight(light, p);
  if (!s) return 1.0;
  const bias = params.biasMult * light.baseBias;
  if (mode === "hard") {
    return s.t - bias <= mt.sampleDepth(s.u, s.v) ? 1.0 : 0.0;
  }
  if (mode === "vsm") {
    const [m1, m2] = mt.sampleMoments(s.u, s.v);
    let pmax = chebyshev(m1, m2, s.t - bias, params.minVariance);
    return reduceLightBleeding(pmax, params.bleeding);
  }
  if (mode === "reference") {
    let lit = 0;
    const r = params.pcfRadius;
    for (const [ox, oy] of POISSON64) {
      const d = mt.sampleDepth(s.u + ox * r, s.v + oy * r);
      if (s.t - bias <= d) lit++;
    }
    return lit / POISSON64.length;
  }
  throw new Error("unknown mode " + mode);
}

function shade(cam, meshes, mts, lights, mode, params) {
  const { width, height, zbuf, worldPos, normals, meshId } = cam;
  const img = new Float32Array(width * height * 3);
  const visSum = new Float32Array(width * height); // summed visibility (for stats)
  const ambient = [0.16, 0.17, 0.19];
  for (let i = 0; i < width * height; i++) {
    if (zbuf[i] === Infinity) continue;
    const p = [worldPos[i * 3], worldPos[i * 3 + 1], worldPos[i * 3 + 2]];
    const n = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
    const albedo = meshes[meshId[i]].color;
    let r = ambient[0] * albedo[0], g = ambient[1] * albedo[1], b = ambient[2] * albedo[2];
    let vAcc = 0;
    for (let li = 0; li < lights.length; li++) {
      const L = lights[li];
      let ldir, atten = 1;
      if (L.type === "directional") {
        ldir = v3.scale(L.dir, -1);
      } else {
        const toFrag = v3.sub(p, L.pos);
        const dist = v3.length(toFrag);
        ldir = v3.scale(toFrag, -1 / dist);
        const cosA = v3.dot(v3.normalize(toFrag), L.dir);
        if (cosA < L.cosOuter) continue;
        atten = Math.min(1, (cosA - L.cosOuter) / (L.cosInner - L.cosOuter));
        atten *= atten;
        atten *= 1 / (1 + 0.02 * dist * dist);
      }
      const ndl = Math.max(0, v3.dot(n, ldir));
      if (ndl <= 0) continue;
      const vis = visibility(mode, mts[li], L, p, params);
      vAcc += vis;
      const k = L.intensity * atten * ndl * vis;
      r += k * L.color[0] * albedo[0];
      g += k * L.color[1] * albedo[1];
      b += k * L.color[2] * albedo[2];
    }
    img[i * 3] = r; img[i * 3 + 1] = g; img[i * 3 + 2] = b;
    visSum[i] = vAcc;
  }
  return { img, visSum };
}

// RMSE / MAE / max-abs of the summed visibility vs the reference solution.
function errorStats(testVis, refVis, zbuf) {
  let se = 0, ae = 0, mx = 0, n = 0;
  for (let i = 0; i < testVis.length; i++) {
    if (zbuf[i] === Infinity) continue;
    const e = testVis[i] - refVis[i];
    se += e * e; ae += Math.abs(e);
    if (Math.abs(e) > mx) mx = Math.abs(e);
    n++;
  }
  return { rmse: Math.sqrt(se / n), mae: ae / n, maxAbs: mx, pixels: n };
}

module.exports = { makeLights, shade, errorStats, projectToLight };
