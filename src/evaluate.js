import { v3, bernstein, bernsteinDeriv } from "./math.js";

function sumBasis(b, pick) {
  let out = [0, 0, 0];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const w = b.u[i] * b.v[j];
      out = v3.add(out, v3.scale(pick(i, j), w));
    }
  }
  return out;
}

// Position and first/second partial derivatives of a bicubic Bezier patch.
export function evaluate(patch, u, v) {
  const bu = bernstein(u), bv = bernstein(v);
  const du = bernsteinDeriv(u), dv = bernsteinDeriv(v);
  const g = patch.grid;
  const position = sumBasis({ u: bu, v: bv }, (i, j) => g[j][i]);
  const Pu = sumBasis({ u: du, v: bv }, (i, j) => g[j][i]);
  const Pv = sumBasis({ u: bu, v: dv }, (i, j) => g[j][i]);
  const Puu = sumBasis({ u: secondDeriv(u), v: bv }, (i, j) => g[j][i]);
  const Pvv = sumBasis({ u: bu, v: secondDeriv(v) }, (i, j) => g[j][i]);
  const normal = v3.norm(v3.cross(Pu, Pv));
  return { position, Pu, Pv, Puu, Pvv, normal };
}

function secondDeriv(t) {
  const u = 1 - t;
  return [6 * u, -18 * u + 6, 18 * t - 6, -6 * t];
}

// Normal-curvature magnitude along a parametric direction, dimensionally
// comparable across patches (curvature = |dT/ds|).
export function directionalCurvature(evalResult, dir) {
  const { Pu, Pv, Puu, Pvv, normal } = evalResult;
  const tangent = dir === "u" ? Pu : Pv;
  const speed = v3.len(tangent) || 1e-9;
  const second = dir === "u" ? Puu : Pvv;
  const normalComponent = v3.dot(second, normal);
  return Math.abs(normalComponent) / (speed * speed);
}

// Deterministic initial 7x7 B-spline control net. Broad overlapping features
// give flat corners, a smooth central swell and a tighter high-curvature zone.
export function createInitialNodes(size = 7) {
  const nodes = [];
  // Widen the control net so the B-spline convex-hull shrink leaves the
  // visible surface spanning roughly the intended 8x8 footprint.
  const span = 11 / (size - 1);
  for (let j = 0; j < size; j++) {
    const row = [];
    for (let i = 0; i < size; i++) {
      const x = (i - (size - 1) / 2) * span;
      const y = (j - (size - 1) / 2) * span;
      const wave = 0.34 * Math.sin(i * 0.8) * Math.cos(j * 0.65);
      const bump = 1.25 * Math.exp(-((i - 4.2) ** 2 + (j - 4.2) ** 2) / 2.8);
      const dip = -0.7 * Math.exp(-((i - 4.4) ** 2 + (j - 1.6) ** 2) / 2.0);
      const swell = 0.4 * Math.exp(-((i - 1.2) ** 2 + (j - 2.6) ** 2) / 4.5);
      row.push([x, y, (wave + bump + dip + swell) * 1.15]);
    }
    nodes.push(row);
  }
  return nodes;
}
