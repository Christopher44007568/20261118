// Node-based verification of the scene-graph logic used by the WebGL2 app.
// Run: node test/scene-graph.test.mjs

import assert from 'node:assert/strict';
import { buildDemoScene } from '../js/demo-scene.js';
import { approxEqual, multiply, transformPoint } from '../js/mat4.js';

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  PASS ${label}`);
}

const { graph, meshes, nodes } = buildDemoScene();
const { root, chassis, turret, barrel, muzzle, wheelFL, wheelFR, crane, armA, armB, hook } = nodes;

console.log('== scene structure ==');
check('four-level nesting (Muzzle depth = 4)', () => {
  assert.equal(muzzle.depth, 4);
  assert.equal(hook.depth, 4);
  assert.equal(root.depth, 0);
});
check('shared geometry assets are reused by reference', () => {
  assert.equal(barrel.mesh, meshes.wheel);
  assert.equal(wheelFL.mesh, meshes.wheel);
  assert.equal(wheelFR.mesh, meshes.wheel);
  assert.equal(chassis.mesh, meshes.cube);
  assert.equal(muzzle.mesh, meshes.cube);
  assert.equal(hook.mesh, meshes.cube);
  assert.equal(armA.mesh, meshes.beam);
  assert.equal(armB.mesh, meshes.beam);
});
check('parent-child relations are bidirectional', () => {
  assert.equal(muzzle.parent, barrel);
  assert.ok(turret.children.includes(barrel));
  assert.ok(root.children.includes(chassis) && root.children.includes(crane));
});

console.log('== selection / bounding boxes ==');
check('selected node has a world AABB containing its mesh corners', () => {
  const sel = turret;
  assert.ok(sel.displayAABB);
  const corner = transformPoint(sel.worldMatrix, [0.5, 0.5, 0.5]);
  for (let k = 0; k < 3; k++) {
    assert.ok(corner[k] >= sel.displayAABB.min[k] - 1e-4);
    assert.ok(corner[k] <= sel.displayAABB.max[k] + 1e-4);
  }
});
check('display AABB aggregates descendants (Turret covers Muzzle)', () => {
  for (let k = 0; k < 3; k++) {
    assert.ok(turret.displayAABB.min[k] <= muzzle.worldAABB.min[k] + 1e-4);
    assert.ok(turret.displayAABB.max[k] >= muzzle.worldAABB.max[k] - 1e-4);
  }
});

console.log('== visibility culling ==');
check('hiding a parent culls its entire subtree', () => {
  turret.visible = false;
  const { drawList, culled } = graph.collectRenderList();
  const culledNames = culled.map((n) => n.name);
  assert.deepEqual(culledNames, ['Turret', 'Barrel', 'Muzzle']);
  assert.ok(!drawList.includes(turret) && !drawList.includes(barrel) && !drawList.includes(muzzle));
  assert.ok(drawList.includes(chassis) && drawList.includes(wheelFL));
  turret.visible = true;
  const again = graph.collectRenderList();
  assert.equal(again.culled.length, 0);
  assert.equal(again.drawList.length, 10); // all mesh nodes drawn again
});

console.log('== incremental matrix update ==');
check('dragging a node updates only its subtree', () => {
  const versionsBefore = new Map([...graph.walk()].map((n) => [n.id, n.matrixVersion]));
  const barrelWorldBefore = new Float32Array(barrel.worldMatrix);
  const turretPosBefore = [turret.worldMatrix[12], turret.worldMatrix[13], turret.worldMatrix[14]];

  graph.translateNodeWorld(turret, [1.5, 0, -0.5]); // one drag operation
  const updated = graph.updateWorldMatrices();
  const updatedNames = updated.map((n) => n.name).sort();

  assert.deepEqual(updatedNames, ['Barrel', 'Muzzle', 'Turret']);
  assert.equal(graph.lastUpdate.count, 3);

  for (const n of graph.walk()) {
    const before = versionsBefore.get(n.id);
    if (updatedNames.includes(n.name)) {
      assert.ok(n.matrixVersion > before, `${n.name} should be bumped`);
    } else {
      assert.equal(n.matrixVersion, before, `${n.name} must NOT be recomputed`);
    }
  }
  // Child world matrix consistent with new parent world matrix.
  const expected = multiply(turret.worldMatrix, barrel.localMatrix);
  assert.ok(approxEqual(barrel.worldMatrix, expected));
  assert.ok(!approxEqual(barrel.worldMatrix, barrelWorldBefore));
  // World-space translation actually moved by the requested delta.
  const moved = [turret.worldMatrix[12], turret.worldMatrix[13], turret.worldMatrix[14]];
  assert.ok(Math.abs(moved[0] - (turretPosBefore[0] + 1.5)) < 1e-4);
  assert.ok(Math.abs(moved[1] - turretPosBefore[1]) < 1e-4);
  assert.ok(Math.abs(moved[2] - (turretPosBefore[2] - 0.5)) < 1e-4);
});

check('upload set = updated nodes that are visible and have a mesh', () => {
  turret.visible = false;
  graph.translateNodeWorld(turret, [0.5, 0, 0]);
  const updated = graph.updateWorldMatrices();
  const { drawList } = graph.collectRenderList();
  const uploadSet = updated.filter((n) => n.mesh && drawList.includes(n));
  assert.equal(updated.length, 3);          // subtree still recomputed
  assert.equal(uploadSet.length, 0);        // but nothing uploaded (all culled)
  turret.visible = true;
  graph.updateWorldMatrices();
});

console.log(`\nAll ${passed} checks passed.`);
