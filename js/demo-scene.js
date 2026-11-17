// Demo scene: 4-level nesting + shared geometry assets.
// Mesh assets are plain data here; the renderer uploads each asset once
// and every referencing node draws the same VAO.

import { SceneGraph, SceneNode } from './scene-graph.js';
import { multiply, translation, scaling, rotationY, rotationZ } from './mat4.js';

export function createBoxMesh(name, w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  // 24 vertices (per-face normals), 36 indices.
  const faces = [
    { n: [1, 0, 0], c: [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]] },
    { n: [-1, 0, 0], c: [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]] },
    { n: [0, 1, 0], c: [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]] },
    { n: [0, -1, 0], c: [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]] },
    { n: [0, 0, 1], c: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]] },
    { n: [0, 0, -1], c: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]] },
  ];
  const positions = [], normals = [], indices = [];
  faces.forEach((f, fi) => {
    for (const v of f.c) { positions.push(...v); normals.push(...f.n); }
    const b = fi * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return {
    name,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    localAABB: { min: [-x, -y, -z], max: [x, y, z] },
  };
}

export function createCylinderMesh(name, radius, height, segments = 16) {
  const positions = [], normals = [], indices = [];
  const half = height / 2;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cx = Math.cos(a), sz = Math.sin(a);
    positions.push(cx * radius, -half, sz * radius, cx * radius, half, sz * radius);
    normals.push(cx, 0, sz, cx, 0, sz);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  return {
    name,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    localAABB: { min: [-radius, -half, -radius], max: [radius, half, radius] },
  };
}

function trs(tx, ty, tz, ry = 0, s = 1) {
  return multiply(translation(tx, ty, tz), multiply(rotationY(ry), scaling(s, s, s)));
}

// Builds the demo scene graph. Returns { graph, meshes, nodes }.
export function buildDemoScene() {
  // Shared geometry assets (uploaded once, referenced by many nodes).
  const meshes = {
    cube: createBoxMesh('cubeMesh', 1, 1, 1),
    beam: createBoxMesh('beamMesh', 0.4, 2.4, 0.4),
    wheel: createCylinderMesh('wheelMesh', 0.5, 0.3, 16),
  };

  const root = new SceneNode('Scene');

  // Level 1
  const chassis = root.addChild(new SceneNode('Chassis', {
    localMatrix: trs(-2.5, 0.6, 0),
    mesh: meshes.cube,
    color: [0.55, 0.62, 0.75, 1],
  }));
  // Level 2
  const turret = chassis.addChild(new SceneNode('Turret', {
    localMatrix: trs(0, 1.0, 0, Math.PI / 6),
    mesh: meshes.cube,
    color: [0.72, 0.55, 0.4, 1],
  }));
  turret.localMatrix = multiply(turret.localMatrix, scaling(0.7, 0.5, 0.7));
  // Level 3
  const barrel = turret.addChild(new SceneNode('Barrel', {
    localMatrix: multiply(trs(0, 0.6, 0.9), rotationZ(Math.PI / 2)),
    mesh: meshes.wheel, // shares cylinder asset with wheels
    color: [0.35, 0.35, 0.38, 1],
  }));
  // Level 4
  const muzzle = barrel.addChild(new SceneNode('Muzzle', {
    localMatrix: trs(0, 0.7, 0, 0, 0.4),
    mesh: meshes.cube,
    color: [0.9, 0.8, 0.3, 1],
  }));

  // Second branch under Chassis sharing the wheel asset.
  const wheelFL = chassis.addChild(new SceneNode('WheelFL', {
    localMatrix: multiply(trs(0.6, -0.4, 0.7), rotationZ(Math.PI / 2)),
    mesh: meshes.wheel,
    color: [0.25, 0.25, 0.28, 1],
  }));
  const wheelFR = chassis.addChild(new SceneNode('WheelFR', {
    localMatrix: multiply(trs(0.6, -0.4, -0.7), rotationZ(Math.PI / 2)),
    mesh: meshes.wheel,
    color: [0.25, 0.25, 0.28, 1],
  }));

  // Independent branch: another 4-level chain sharing beam/cube assets.
  const crane = root.addChild(new SceneNode('Crane', {
    localMatrix: trs(2.5, 0, 0),
    mesh: meshes.cube,
    color: [0.5, 0.68, 0.5, 1],
  }));
  const armA = crane.addChild(new SceneNode('ArmA', {
    localMatrix: trs(0, 1.6, 0),
    mesh: meshes.beam,
    color: [0.85, 0.7, 0.3, 1],
  }));
  const armB = armA.addChild(new SceneNode('ArmB', {
    localMatrix: multiply(trs(0, 1.4, 0), rotationZ(-Math.PI / 3)),
    mesh: meshes.beam,
    color: [0.85, 0.75, 0.4, 1],
  }));
  const hook = armB.addChild(new SceneNode('Hook', {
    localMatrix: trs(0, 1.5, 0, 0, 0.5),
    mesh: meshes.cube,
    color: [0.8, 0.3, 0.3, 1],
  }));

  const graph = new SceneGraph(root);
  graph.updateWorldMatrices();
  return {
    graph,
    meshes,
    nodes: { root, chassis, turret, barrel, muzzle, wheelFL, wheelFR, crane, armA, armB, hook },
  };
}
