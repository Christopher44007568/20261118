import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3, m4, rayTriangle } from '../js/math3.js';
import { createSphere, createGrid } from '../js/primitives.js';
import {
  createAnchor,
  resolveAnchor,
  createMeasurement,
  straightDistance,
  surfaceDistance,
  serializeMeasurements,
  deserializeMeasurements,
} from '../js/measure.js';

function closeTo(actual, expected, eps = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${actual} ≈ ${expected}`
  );
}

test('ray-triangle hit returns barycentric coords', () => {
  const hit = rayTriangle(
    [0.25, 0.25, 1],
    [0, 0, -1],
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0]
  );
  assert.ok(hit);
  closeTo(hit.t, 1);
  closeTo(hit.u, 0.25);
  closeTo(hit.v, 0.25);
});

test('anchor follows vertex deformation', () => {
  const mesh = createGrid(2, 8);
  const tri = 10;
  const anchor = createAnchor(mesh, tri, 0.3, 0.4);
  const before = resolveAnchor(anchor, mesh);
  assert.ok(before.ok);
  mesh.setDeform(0.8);
  const after = resolveAnchor(anchor, mesh);
  assert.ok(after.ok);
  assert.ok(v3.distance(before.position, after.position) > 1e-4);
  const expected = mesh.worldPointOnTriangle(tri, 0.3, 0.4);
  assert.ok(v3.distance(after.position, expected) < 1e-9);
});

test('anchor follows non-uniform scale', () => {
  const mesh = createGrid(2, 8);
  const tri = 3;
  const anchor = createAnchor(mesh, tri, 0.2, 0.5);
  mesh.scale = [2, 0.5, 3];
  const r = resolveAnchor(anchor, mesh);
  assert.ok(r.ok);
  const local = mesh.pointOnTriangle(tri, 0.2, 0.5);
  closeTo(r.position[0], local[0] * 2);
  closeTo(r.position[1], local[1] * 0.5);
  closeTo(r.position[2], local[2] * 3);
});

test('straight distance reflects object transform', () => {
  const mesh = createGrid(2, 4);
  const meshById = new Map([[mesh.id, mesh]]);
  const a = createAnchor(mesh, 0, 0, 0);
  const b = createAnchor(mesh, mesh.triangleCount - 1, 1, 0);
  const m = createMeasurement(a, b);
  const d1 = straightDistance(m, meshById);
  mesh.scale = [3, 1, 1];
  const d2 = straightDistance(m, meshById);
  assert.ok(d2 > d1, 'non-uniform scale should change straight distance');
});

test('topology version change invalidates measurement', () => {
  const mesh = createSphere(8, 12);
  const anchor = createAnchor(mesh, 5, 0.3, 0.3);
  assert.ok(resolveAnchor(anchor, mesh).ok);
  mesh.subdivide();
  const r = resolveAnchor(anchor, mesh);
  assert.equal(r.ok, false);
  assert.match(r.reason, /拓扑/);
});

test('degenerate triangle invalidates measurement', () => {
  const mesh = createGrid(2, 4);
  const anchor = createAnchor(mesh, 0, 0.25, 0.25);
  assert.ok(resolveAnchor(anchor, mesh).ok);
  mesh.collapseFirstTriangle();
  const r = resolveAnchor(anchor, mesh);
  assert.equal(r.ok, false);
  assert.match(r.reason, /退化/);
});

test('surface distance >= straight distance on same mesh', () => {
  const mesh = createSphere(16, 24);
  const meshById = new Map([[mesh.id, mesh]]);
  // Triangles away from the (degenerate) pole rows.
  const a = createAnchor(mesh, 200, 0.5, 0.2);
  const b = createAnchor(mesh, 400, 0.5, 0.2);
  const m = createMeasurement(a, b);
  const d = straightDistance(m, meshById);
  const g = surfaceDistance(m, meshById);
  assert.ok(g != null);
  assert.ok(g >= d - 1e-6, `geodesic ${g} should be >= straight ${d}`);
});

test('surface distance is null across meshes', () => {
  const m1 = createSphere(8, 12);
  const m2 = createGrid(2, 4);
  const meshById = new Map([[m1.id, m1], [m2.id, m2]]);
  const m = createMeasurement(
    createAnchor(m1, 100, 0.3, 0.3),
    createAnchor(m2, 0, 0.3, 0.3)
  );
  assert.equal(surfaceDistance(m, meshById), null);
  assert.ok(straightDistance(m, meshById) != null);
});

test('save/load roundtrip preserves anchors and validity', () => {
  const mesh = createSphere(8, 12);
  const meshById = new Map([[mesh.id, mesh]]);
  const m = createMeasurement(
    createAnchor(mesh, 3, 0.1, 0.2),
    createAnchor(mesh, 40, 0.6, 0.1)
  );
  const json = serializeMeasurements([m]);
  const [loaded] = deserializeMeasurements(json);
  assert.deepEqual(loaded.a, m.a);
  assert.deepEqual(loaded.b, m.b);
  closeTo(straightDistance(loaded, meshById), straightDistance(m, meshById));
});

test('loaded measurement becomes invalid after topology change, not remapped', () => {
  const mesh = createSphere(8, 12);
  const meshById = new Map([[mesh.id, mesh]]);
  const m = createMeasurement(
    createAnchor(mesh, 3, 0.1, 0.2),
    createAnchor(mesh, 40, 0.6, 0.1)
  );
  const [loaded] = deserializeMeasurements(serializeMeasurements([m]));
  mesh.subdivide();
  assert.equal(resolveAnchor(loaded.a, mesh).ok, false);
  assert.equal(straightDistance(loaded, meshById), null);
});

test('mat4 invert/transform roundtrip', () => {
  const m = m4.multiply(
    m4.translation(1, 2, 3),
    m4.multiply(m4.rotationY(0.7), m4.scaling(2, 0.5, 3))
  );
  const inv = m4.invert(m);
  const p = [0.3, -1.2, 2.5];
  const q = m4.transformPoint(inv, m4.transformPoint(m, p));
  assert.ok(v3.distance(p, q) < 1e-9);
});
