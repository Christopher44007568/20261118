import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBooleanEngine } from '../src/mesh/booleanEngine.js';
import { getScene, SCENE_ORDER, OPERATIONS } from '../src/mesh/scenes.js';

const engine = await loadBooleanEngine();

function run(sceneId, operation) {
  const scene = getScene(sceneId);
  return engine.execute(scene.a, scene.b, operation);
}

function solidVolume(mesh) {
  const manifold = engine.toManifold(mesh);
  try {
    return manifold.volume();
  } finally {
    manifold.delete();
  }
}

function assertWatertight(result, label) {
  const topology = result.topology;
  assert.equal(topology.closed, true, `${label}: topology must be closed`);
  assert.equal(topology.outward, true, `${label}: normals must face outward`);
  assert.equal(topology.boundaryEdges, 0, `${label}: no boundary edges`);
  assert.equal(topology.nonManifoldEdges, 0, `${label}: no non-manifold edges`);
  assert.equal(topology.orientationConflicts, 0, `${label}: consistent winding`);
  assert.equal(topology.degenerateTriangles, 0, `${label}: no degenerate triangles`);
}

test('all scenarios and operations produce closed, outward results', async (t) => {
  for (const sceneId of SCENE_ORDER) {
    for (const operation of OPERATIONS) {
      await t.test(`${sceneId} / ${operation.id}`, () => {
        const result = run(sceneId, operation.id);
        assert.equal(result.status, 'NoError');
        assertWatertight(result, `${sceneId}/${operation.id}`);
        if (!result.topology.empty) {
          assert.ok(result.volume > 0, 'non-empty result has positive volume');
        }
      });
    }
  }
});

test('disjoint results preserve each solid exactly', () => {
  const scene = getScene('disjoint');
  const singleVolume = solidVolume(scene.a);
  const union = run('disjoint', 'union');
  const difference = run('disjoint', 'difference');
  const intersection = run('disjoint', 'intersection');

  assert.ok(Math.abs(union.volume - singleVolume * 2) < 1e-4);
  assert.ok(Math.abs(difference.volume - singleVolume) < 1e-4);
  assert.equal(intersection.topology.empty, true);
  assert.equal(intersection.topology.triangleCount, 0);
});

test('intersecting results satisfy Boolean volume identities', () => {
  const scene = getScene('intersecting');
  const union = run('intersecting', 'union');
  const difference = run('intersecting', 'difference');
  const intersection = run('intersecting', 'intersection');
  const volumeA = solidVolume(scene.a);
  const volumeB = solidVolume(scene.b);

  assert.ok(intersection.volume > 0);
  assert.ok(Math.abs(difference.volume + intersection.volume - volumeA) < 1e-4);
  assert.ok(
    Math.abs(union.volume - (volumeA + volumeB - intersection.volume)) < 1e-4,
  );
  assert.ok(union.volume > intersection.volume);
});

test('coplanar contact removes the shared internal face without holes', () => {
  const scene = getScene('coplanar');
  const union = run('coplanar', 'union');
  const difference = run('coplanar', 'difference');
  const intersection = run('coplanar', 'intersection');

  assert.equal(intersection.topology.empty, true);
  assert.ok(
    Math.abs(union.volume - (solidVolume(scene.a) + solidVolume(scene.b))) < 1e-4,
  );
  assert.ok(Math.abs(difference.volume - solidVolume(scene.a)) < 1e-4);
  assert.equal(union.topology.boundaryEdges, 0);
  assert.equal(union.topology.nonManifoldEdges, 0);
  assert.ok(union.topology.degenerateTriangles === 0);
});

test('every result survives OBJ export, reload and topology inspection', async (t) => {
  for (const sceneId of SCENE_ORDER) {
    for (const operation of OPERATIONS) {
      await t.test(`${sceneId} / ${operation.id}`, () => {
        const result = run(sceneId, operation.id);
        const report = engine.verifyOBJRoundTrip(result.mesh);
        assert.equal(report.passed, true);
        assert.equal(report.reloadedTopology.closed, true);
        assert.equal(report.reloadedTopology.outward, true);
        assert.equal(report.verticesMatch, true);
        assert.equal(report.trianglesMatch, true);
        assert.equal(report.reloadedTopology.boundaryEdges, 0);
      });
    }
  }
});
