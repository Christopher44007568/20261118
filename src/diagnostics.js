import { v3 } from "./math.js";
import { evaluate } from "./evaluate.js";
import { PATCHES } from "./bspline-surface.js";

const SEAM_SAMPLES = 24;
const SIL_SAMPLES = 48;

// Geometric continuity audit of the adaptive mesh and the analytic surface.
export function runDiagnostics(surface, tessellator, meshes) {
  const seamGap = measureSeamGap(meshes);
  const tangent = measureTangentContinuity(surface);
  const silhouette = measureSilhouette(surface, tessellator, tessellator.camera);
  const secondDerivError = measureSecondDerivative(surface);
  return {
    seamGap,
    tangentError: tangent.maxTangentError,
    normalAngleDegrees: tangent.maxNormalAngleDeg,
    secondDerivativeError: secondDerivError,
    silhouetteSagittaPx: silhouette.sagittaPx,
    silhouetteShortening: silhouette.shortening,
    samples: SEAM_SAMPLES * PATCHES * 2 + SIL_SAMPLES * 4,
    continuity: secondDerivError < 1e-8
      ? "C2"
      : tangent.maxNormalAngleDeg < 1e-3 && tangent.maxTangentError < 1e-8
        ? "C1"
        : "C0"
  };
}

// Second-partial continuity across internal seams (the B-spline model should
// satisfy this exactly; a C1-only Ferguson model would fail it).
function measureSecondDerivative(surface) {
  if (typeof surface.evaluateCell !== "function") return Infinity;
  let maxError = 0;
  for (let r = 0; r < PATCHES; r++) {
    for (let c = 0; c < PATCHES - 1; c++) {
      for (let s = 0; s <= SEAM_SAMPLES; s++) {
        const t = s / SEAM_SAMPLES;
        const a = surface.evaluateCell(c, r, 1, t);
        const b = surface.evaluateCell(c + 1, r, 0, t);
        maxError = Math.max(maxError, v3.len(v3.sub(a.Puu, b.Puu)));
      }
    }
  }
  for (let r = 0; r < PATCHES - 1; r++) {
    for (let c = 0; c < PATCHES; c++) {
      for (let s = 0; s <= SEAM_SAMPLES; s++) {
        const t = s / SEAM_SAMPLES;
        const a = surface.evaluateCell(c, r, t, 1);
        const b = surface.evaluateCell(c, r + 1, t, 0);
        maxError = Math.max(maxError, v3.len(v3.sub(a.Pvv, b.Pvv)));
      }
    }
  }
  return maxError;
}

// Largest 3D distance between coincident boundary samples of adjacent meshes.
function measureSeamGap(meshes) {
  let gap = 0;
  for (let r = 0; r < PATCHES; r++) {
    for (let c = 0; c < PATCHES - 1; c++) {
      const a = meshes[r * PATCHES + c];
      const b = meshes[r * PATCHES + c + 1];
      for (let j = 0; j <= a.nv; j++) {
        const pa = a.positions[j * (a.nu + 1) + a.nu];
        const pb = b.positions[j * (b.nu + 1)];
        gap = Math.max(gap, v3.len(v3.sub(pa, pb)));
      }
    }
  }
  for (let r = 0; r < PATCHES - 1; r++) {
    for (let c = 0; c < PATCHES; c++) {
      const a = meshes[r * PATCHES + c];
      const b = meshes[(r + 1) * PATCHES + c];
      for (let i = 0; i <= a.nu; i++) {
        const pa = a.positions[a.nv * (a.nu + 1) + i];
        const pb = b.positions[i];
        gap = Math.max(gap, v3.len(v3.sub(pa, pb)));
      }
    }
  }
  return gap;
}

// Analytic C1 check: partials and normals across every internal patch seam.
function measureTangentContinuity(surface) {
  let maxTangentError = 0;
  let maxNormalAngleDeg = 0;
  for (let r = 0; r < PATCHES; r++) {
    for (let c = 0; c < PATCHES - 1; c++) {
      const left = surface.patches[r * PATCHES + c];
      const right = surface.patches[r * PATCHES + c + 1];
      for (let s = 0; s <= SEAM_SAMPLES; s++) {
        const t = s / SEAM_SAMPLES;
        const ea = evaluate(left, 1, t);
        const eb = evaluate(right, 0, t);
        maxTangentError = Math.max(maxTangentError, v3.len(v3.sub(ea.Pu, eb.Pu)));
        maxNormalAngleDeg = Math.max(maxNormalAngleDeg, angleDeg(ea.normal, eb.normal));
      }
    }
  }
  for (let r = 0; r < PATCHES - 1; r++) {
    for (let c = 0; c < PATCHES; c++) {
      const top = surface.patches[r * PATCHES + c];
      const bottom = surface.patches[(r + 1) * PATCHES + c];
      for (let s = 0; s <= SEAM_SAMPLES; s++) {
        const t = s / SEAM_SAMPLES;
        const ea = evaluate(top, t, 1);
        const eb = evaluate(bottom, t, 0);
        maxTangentError = Math.max(maxTangentError, v3.len(v3.sub(ea.Pv, eb.Pv)));
        maxNormalAngleDeg = Math.max(maxNormalAngleDeg, angleDeg(ea.normal, eb.normal));
      }
    }
  }
  return { maxTangentError, maxNormalAngleDeg };
}

function angleDeg(a, b) {
  const cos = Math.min(1, Math.max(-1, v3.dot(a, b)));
  return Math.acos(cos) * 180 / Math.PI;
}

// Silhouette audit: along each boundary, pick segments that lie on the
// silhouette (normal ~ perpendicular to view ray) and compare the actual
// mesh edge chord against the analytic Bezier arc at the same parameters.
// Sagitta catches shortened polylines; arc-vs-chord catches length loss.
function measureSilhouette(surface, tessellator, camera) {
  const { uLevels, vLevels } = tessellator;
  let maxSagitta = 0;
  let arcPx = 0;
  let chordPx = 0;
  const boundaries = [];
  for (let c = 0; c < PATCHES; c++) {
    boundaries.push({ patch: surface.patches[c], along: "v", u: 0 });
    boundaries.push({ patch: surface.patches[PATCHES * (PATCHES - 1) + c], along: "v", u: 1 });
  }
  for (let r = 0; r < PATCHES; r++) {
    boundaries.push({ patch: surface.patches[r * PATCHES], along: "u", v: 0 });
    boundaries.push({ patch: surface.patches[r * PATCHES + PATCHES - 1], along: "u", v: 1 });
  }

  for (const b of boundaries) {
    const segments = b.along === "u"
      ? uLevels[b.patch.r][b.patch.c]
      : vLevels[b.patch.r][b.patch.c];
    const evalAt = (t) => evaluate(
      b.patch,
      b.along === "u" ? t : b.u,
      b.along === "v" ? t : b.v);
    for (let s = 0; s < segments; s++) {
      const t0 = s / segments;
      const t1 = (s + 1) / segments;
      const e0 = evalAt(t0);
      const e1 = evalAt(t1);
      const facing = Math.abs(v3.dot(e0.normal,
        v3.norm(v3.sub(camera.eye, e0.position))));
      if (facing > 0.35) continue;
      const pa = camera.project(e0.position);
      const pb = camera.project(e1.position);
      const analyticMid = camera.project(evalAt((t0 + t1) / 2).position);
      const chordMid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
      maxSagitta = Math.max(maxSagitta,
        Math.hypot(chordMid[0] - analyticMid[0], chordMid[1] - analyticMid[1]));
      // Dense sub-sampling of the true arc gives a reference arc length.
      arcPx += denseArcPx(camera, evalAt, t0, t1);
      chordPx += Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    }
  }
  return {
    sagittaPx: maxSagitta,
    shortening: arcPx > 0 ? (arcPx - chordPx) / arcPx : 0
  };
}

function denseArcPx(camera, evalAt, t0, t1) {
  let total = 0;
  let prev = camera.project(evalAt(t0).position);
  for (let k = 1; k <= 12; k++) {
    const q = camera.project(evalAt(t0 + (t1 - t0) * k / 12).position);
    total += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    prev = q;
  }
  return total;
}
