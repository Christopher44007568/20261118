// Error metrics between the float32 source mesh and its decoded counterpart.

import { computeAabb, cross3 } from './mesh.js';

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// Lambert shading under one fixed directional light; used for the color
// difference heatmap so the visual error is driven by normal reconstruction.
export function shade(normal, lightDir) {
  const ndl = Math.max(0, dot3(normal, lightDir));
  return [0.18 + 0.82 * ndl, 0.22 + 0.72 * ndl, 0.32 + 0.6 * ndl];
}

export function analyze(mesh, decoded, packed) {
  const count = mesh.positions.length / 3;
  const aabb = mesh.aabb;
  const diag = Math.hypot(
    aabb.max[0] - aabb.min[0],
    aabb.max[1] - aabb.min[1],
    aabb.max[2] - aabb.min[2]
  ) || 1;
  const light = (() => {
    const v = [-0.4, -0.7, -0.55];
    const len = Math.hypot(...v);
    return v.map((x) => -x / len);
  })();

  let posMax = 0, posMaxRel = 0, posWorst = 0;
  let uvMax = 0, uvWorst = 0;
  let nrmLenMax = 0, nrmAngMax = 0, nrmWorst = 0;
  let tanLenMax = 0, tanAngMax = 0, handMismatch = 0, tanWorst = 0;
  let colorMax = 0, colorWorst = 0;
  const heat = new Float32Array(count);

  for (let v = 0; v < count; v++) {
    const p0 = mesh.positions.slice(3 * v, 3 * v + 3);
    const p1 = decoded.positions.slice(3 * v, 3 * v + 3);
    const pErr = Math.hypot(...sub3(p1, p0));
    const pRel = pErr / diag;
    if (pErr > posMax) { posMax = pErr; posWorst = v; }
    posMaxRel = Math.max(posMaxRel, pRel);

    const uv0 = mesh.uvs.slice(2 * v, 2 * v + 2);
    const uv1 = decoded.uvs.slice(2 * v, 2 * v + 2);
    const uvErr = Math.hypot(uv1[0] - uv0[0], uv1[1] - uv0[1]);
    if (uvErr > uvMax) { uvMax = uvErr; uvWorst = v; }

    const n0 = mesh.normals.slice(3 * v, 3 * v + 3);
    const n1 = decoded.normals.slice(3 * v, 3 * v + 3);
    const nLen = Math.abs(Math.hypot(...n1) - 1);
    const nCos = Math.max(-1, Math.min(1, dot3(n0, n1)));
    const nAng = (Math.acos(nCos) * 180) / Math.PI;
    if (nAng > nrmAngMax) { nrmAngMax = nAng; nrmWorst = v; }
    nrmLenMax = Math.max(nrmLenMax, nLen);

    const t0 = mesh.tangent.slice(3 * v, 3 * v + 3);
    const t1 = decoded.tangent.slice(3 * v, 3 * v + 3);
    const tLen = Math.abs(Math.hypot(...t1) - 1);
    const tCos = Math.max(-1, Math.min(1, dot3(t0, t1)));
    const tAng = (Math.acos(Math.abs(tCos)) * 180) / Math.PI;
    if (tAng > tanAngMax) { tanAngMax = tAng; tanWorst = v; }
    tanLenMax = Math.max(tanLenMax, tLen);
    if (decoded.handedness[v] !== mesh.handedness[v]) handMismatch++;

    const c0 = shade(n0, light);
    const c1 = shade(n1, light);
    const cErr = Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]);
    if (cErr > colorMax) { colorMax = cErr; colorWorst = v; }
    heat[v] = cErr;
  }

  const decAabb = computeAabb(decoded.positions);
  const eps = 1e-7;
  const overshoot = {
    min: decAabb.min.map((v, k) => Math.max(0, aabb.min[k] - v)),
    max: decAabb.max.map((v, k) => Math.max(0, v - aabb.max[k])),
  };
  const inside =
    overshoot.min.every((v) => v <= eps) && overshoot.max.every((v) => v <= eps);

  return {
    vertexCount: count,
    position: { maxAbs: posMax, maxRelative: posMaxRel, worstVertex: posWorst },
    uv: { maxAbs: uvMax, worstVertex: uvWorst },
    normal: {
      maxLengthError: nrmLenMax,
      maxAngleDeg: nrmAngMax,
      worstVertex: nrmWorst,
    },
    tangent: {
      maxLengthError: tanLenMax,
      maxAngleDeg: tanAngMax,
      handednessMismatches: handMismatch,
      worstVertex: tanWorst,
    },
    color: { maxRgbDistance: colorMax, worstVertex: colorWorst, heat },
    aabb: { source: aabb, decoded: decAabb, overshoot, inside },
    bboxDiagonal: diag,
  };
}

export function frameOrthonormalError(decoded) {
  // Independent check: reconstructed T,N,B must be mutually orthonormal.
  const count = decoded.positions.length / 3;
  let maxErr = 0;
  for (let v = 0; v < count; v++) {
    const n = decoded.normals.slice(3 * v, 3 * v + 3);
    const t = decoded.tangent.slice(3 * v, 3 * v + 3);
    const h = decoded.handedness[v];
    const b = cross3(n, t).map((x) => x * h);
    maxErr = Math.max(
      maxErr,
      Math.abs(dot3(n, t)),
      Math.abs(dot3(n, b)),
      Math.abs(dot3(t, b)),
      Math.abs(Math.hypot(...b) - 1)
    );
  }
  return maxErr;
}
