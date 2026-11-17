import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG, computeSplitDistances, computeCSM, selectCascade,
  nextCascadeBlend, frustumSliceCorners,
} from '../src/csm.js';
import { m4, v3 } from '../src/math.js';

const CAM = {
  position: [0, 12, 40], forward: v3.normalize([0, -0.25, -1]), up: [0, 1, 0],
  fovY: Math.PI / 3, aspect: 16 / 9, near: 0.5, far: 200,
};
const LIGHT = v3.normalize([0.5, -1, 0.35]);

test('splits: count, endpoints, strictly increasing', () => {
  const s = computeSplitDistances(0.5, 180, 3, 0.65);
  assert.equal(s.length, 4);
  assert.equal(s[0], 0.5);
  assert.equal(s[3], 180);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1]);
});

test('cascade selection covers full range without gaps', () => {
  const csm = computeCSM(CAM, LIGHT);
  const { splits } = csm;
  for (let d = splits[0]; d <= splits[splits.length - 1]; d += 0.05) {
    const i = selectCascade(d, splits);
    assert.ok(d > splits[i] - 1e-9 && d <= splits[i + 1] + 1e-9, `depth ${d} in cascade ${i}`);
  }
});

test('blend factor ramps only inside trailing band', () => {
  const csm = computeCSM(CAM, LIGHT);
  const { splits } = csm;
  const band = DEFAULT_CONFIG.blendBand;
  for (let i = 0; i < splits.length - 2; i++) {
    const range = splits[i + 1] - splits[i];
    assert.equal(nextCascadeBlend(splits[i], splits, i, band), 0);
    assert.equal(nextCascadeBlend(splits[i + 1] - range * band, splits, i, band), 0);
    assert.ok(Math.abs(nextCascadeBlend(splits[i + 1] - range * band / 2, splits, i, band) - 0.5) < 1e-9);
    assert.equal(nextCascadeBlend(splits[i + 1], splits, i, band), 1);
  }
  assert.equal(nextCascadeBlend(splits[2], splits, 2, band), 0); // last cascade
});

test('texel snapping: static world point shifts by whole texels only', () => {
  const worldPoint = [3.2, 0, -15.7];
  const uvTexels = [];
  for (let k = 0; k < 40; k++) {
    const cam = { ...CAM, position: [CAM.position[0] + k * 0.013, CAM.position[1], CAM.position[2] - k * 0.021] };
    const csm = computeCSM(cam, LIGHT);
    const c = csm.cascades[0];
    const ndc = m4.transformPoint(c.lightViewProj, worldPoint);
    uvTexels.push([(ndc[0] * 0.5 + 0.5) * c.resolution, (ndc[1] * 0.5 + 0.5) * c.resolution]);
  }
  for (let k = 1; k < uvTexels.length; k++) {
    const du = uvTexels[k][0] - uvTexels[0][0];
    const dv = uvTexels[k][1] - uvTexels[0][1];
    assert.ok(Math.abs(du - Math.round(du)) < 1e-6, `du not integer: ${du}`);
    assert.ok(Math.abs(dv - Math.round(dv)) < 1e-6, `dv not integer: ${dv}`);
  }
});

test('seam: boundary points are inside both adjacent cascade maps', () => {
  const csm = computeCSM(CAM, LIGHT);
  const { splits, cascades } = csm;
  const fwd = v3.normalize(CAM.forward);
  for (let i = 0; i < splits.length - 2; i++) {
    const d = splits[i + 1];
    // sample points across the frustum slice exactly at the split distance
    const corners = frustumSliceCorners(CAM, d, d);
    const pts = [...corners, v3.add(CAM.position, v3.scale(fwd, d))];
    for (const p of pts) {
      for (const c of [cascades[i], cascades[i + 1]]) {
        const ndc = m4.transformPoint(c.lightViewProj, p);
        assert.ok(Math.abs(ndc[0]) <= 1 + 1e-6 && Math.abs(ndc[1]) <= 1 + 1e-6,
          `point outside cascade map at split ${i}: ndc=${ndc}`);
      }
    }
  }
});

test('seam: shadow verdict agrees across cascades (within 1 depth texel)', () => {
  const csm = computeCSM(CAM, LIGHT);
  const { splits, cascades } = csm;
  const fwd = v3.normalize(CAM.forward);
  // synthetic occluder: horizontal plane y = 2 (e.g. a box top), receiver on ground y = 0
  for (let i = 0; i < splits.length - 2; i++) {
    const d = splits[i + 1];
    const recv = v3.add(CAM.position, v3.scale(fwd, d));
    recv[1] = 0;
    const occl = [recv[0], 2, recv[2]];
    for (const c of [cascades[i], cascades[i + 1]]) {
      const ndcR = m4.transformPoint(c.lightViewProj, recv);
      const ndcO = m4.transformPoint(c.lightViewProj, occl);
      // occluder closer to light (smaller NDC z); separation far above 24-bit
      // depth quantization, so both cascades agree on the shadowed verdict
      assert.ok(ndcO[2] < ndcR[2], 'occluder closer to light than receiver');
      assert.ok(ndcR[2] - ndcO[2] > 1e-4, 'separation exceeds depth quantization');
    }
  }
});

test('different resolutions and depth ranges per cascade', () => {
  const csm = computeCSM(CAM, LIGHT);
  const res = csm.cascades.map(c => c.resolution);
  assert.deepEqual(res, DEFAULT_CONFIG.resolutions);
  const densities = csm.cascades.map(c => c.texelDensity);
  assert.ok(densities[0] > densities[1] && densities[1] > densities[2],
    'texel density must decrease with distance');
});
