// Pure scene-graph logic: hierarchy, dirty-flag matrix propagation,
// visibility culling, world AABBs. No DOM/WebGL deps (testable in Node).

import { identity, multiply, transformPoint, invert, translation } from './mat4.js';

let nextNodeId = 1;

export class SceneNode {
  constructor(name, options = {}) {
    this.id = nextNodeId++;
    this.name = name;
    this.parent = null;
    this.children = [];
    this.localMatrix = options.localMatrix || identity();
    this.worldMatrix = identity();
    this.visible = options.visible !== undefined ? options.visible : true;
    this.mesh = options.mesh || null;        // shared MeshAsset reference
    this.color = options.color || [0.8, 0.8, 0.8, 1];
    this.worldAABB = null;                   // own mesh AABB in world space
    this.displayAABB = null;                 // own + descendants (for selection box)
    this.matrixVersion = 0;                  // bumped when worldMatrix recomputed
    this.dirty = true;                       // local transform changed since last update
  }

  addChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  get depth() {
    let d = 0;
    let n = this.parent;
    while (n) { d++; n = n.parent; }
    return d;
  }
}

export class SceneGraph {
  constructor(root) {
    this.root = root;
    this.lastUpdate = { updatedNodes: [], count: 0 };
  }

  *walk(node = this.root) {
    yield node;
    for (const child of node.children) yield* this.walk(child);
  }

  subtreeNodes(node) {
    return [...this.walk(node)];
  }

  findByName(name) {
    for (const n of this.walk()) if (n.name === name) return n;
    return null;
  }

  // Mark only this node's subtree as needing world-matrix recompute.
  setLocalMatrix(node, m) {
    node.localMatrix = m;
    for (const n of this.walk(node)) n.dirty = true;
  }

  // Translate node by a delta expressed in world space.
  translateNodeWorld(node, delta) {
    let localDelta = delta;
    if (node.parent) {
      const invParent = invert(node.parent.worldMatrix);
      if (invParent) {
        const p0 = transformPoint(invParent, [0, 0, 0]);
        const p1 = transformPoint(invParent, delta);
        localDelta = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      }
    }
    const t = translation(localDelta[0], localDelta[1], localDelta[2]);
    this.setLocalMatrix(node, multiply(t, node.localMatrix));
  }

  // Recompute world matrices for dirty subtrees only.
  // Returns the list of nodes whose world matrix was recomputed.
  updateWorldMatrices() {
    const updated = [];
    const visit = (node, parentWorld, parentChanged) => {
      let changed = parentChanged;
      if (node.dirty || parentChanged) {
        node.worldMatrix = parentWorld ? multiply(parentWorld, node.localMatrix) : node.localMatrix;
        node.matrixVersion++;
        node.dirty = false;
        changed = true;
        updated.push(node);
        node.worldAABB = node.mesh ? transformAABB(node.mesh.localAABB, node.worldMatrix) : null;
      }
      for (const child of node.children) visit(child, node.worldMatrix, changed);
    };
    visit(this.root, null, false);

    // Aggregate display AABBs bottom-up (cheap; does not count as matrix update).
    const aggregate = (node) => {
      let box = node.worldAABB ? cloneAABB(node.worldAABB) : null;
      for (const child of node.children) {
        const childBox = aggregate(child);
        box = box ? unionAABB(box, childBox) : childBox;
      }
      node.displayAABB = box;
      return box;
    };
    aggregate(this.root);

    this.lastUpdate = { updatedNodes: updated, count: updated.length };
    return updated;
  }

  // Visibility culling: an invisible node culls its whole subtree.
  collectRenderList() {
    const drawList = [];
    const culled = [];
    const visit = (node, parentVisible) => {
      const visible = parentVisible && node.visible;
      if (!visible) {
        for (const n of this.walk(node)) culled.push(n);
        return;
      }
      if (node.mesh) drawList.push(node);
      for (const child of node.children) visit(child, visible);
    };
    visit(this.root, true);
    return { drawList, culled };
  }
}

export function transformAABB(aabb, m) {
  const { min, max } = aabb;
  const out = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < 8; i++) {
    const corner = [
      i & 1 ? max[0] : min[0],
      i & 2 ? max[1] : min[1],
      i & 4 ? max[2] : min[2],
    ];
    const p = transformPoint(m, corner);
    for (let k = 0; k < 3; k++) {
      out.min[k] = Math.min(out.min[k], p[k]);
      out.max[k] = Math.max(out.max[k], p[k]);
    }
  }
  return out;
}

export function unionAABB(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

function cloneAABB(a) {
  return { min: [...a.min], max: [...a.max] };
}
