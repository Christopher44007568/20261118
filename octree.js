// Core math, frustum and octree culling shared by the UI and the Node verifier.

export function vec3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function sub(a, b) {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function add(a, b) {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function scale(a, s) {
  return vec3(a.x * s, a.y * s, a.z * s);
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a, b) {
  return vec3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
  );
}

export function normalize(a) {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return vec3(a.x / len, a.y / len, a.z / len);
}

export function aabb(min, max) {
  return { min: vec3(min.x, min.y, min.z), max: vec3(max.x, max.y, max.z) };
}

export function aabbContainsBox(outer, inner) {
  return (
    outer.min.x <= inner.min.x && outer.max.x >= inner.max.x &&
    outer.min.y <= inner.min.y && outer.max.y >= inner.max.y &&
    outer.min.z <= inner.min.z && outer.max.z >= inner.max.z
  );
}

let nextObjectId = 1;
export function makeObject(center, halfSize, dynamic = false) {
  const half = vec3(halfSize.x, halfSize.y, halfSize.z);
  return {
    id: nextObjectId++,
    dynamic,
    center: vec3(center.x, center.y, center.z),
    half,
    box: aabb(sub(center, half), add(center, half)),
  };
}

export function moveObject(obj, center) {
  obj.center = vec3(center.x, center.y, center.z);
  obj.box = aabb(sub(center, obj.half), add(center, obj.half));
}

// Perspective camera -> 6 frustum planes (normals point inward).
export class Frustum {
  constructor({ position, target, up = vec3(0, 1, 0), fovYDeg, aspect, near, far }) {
    this.position = vec3(position.x, position.y, position.z);
    this.fovYDeg = fovYDeg;
    this.aspect = aspect;
    this.near = near;
    this.far = far;

    const forward = normalize(sub(target, position));
    const right = normalize(cross(forward, up));
    const trueUp = cross(right, forward);
    this.forward = forward;
    this.right = right;
    this.up = trueUp;

    const tanH = Math.tan((fovYDeg * Math.PI) / 360);
    const tanW = tanH * aspect;

    const nc = add(this.position, scale(forward, near));
    const fc = add(this.position, scale(forward, far));

    const plane = (point, normal) => {
      const n = normalize(normal);
      return { normal: n, d: -dot(n, point) };
    };

    const dirNL = normalize(add(scale(forward, near), scale(right, -near * tanW)));
    const dirNR = normalize(add(scale(forward, near), scale(right, near * tanW)));
    const dirNT = normalize(add(scale(forward, near), scale(trueUp, near * tanH)));
    const dirNB = normalize(add(scale(forward, near), scale(trueUp, -near * tanH)));

    this.planes = [
      plane(nc, forward),                              // near
      plane(fc, scale(forward, -1)),                   // far
      plane(this.position, cross(dirNL, trueUp)),      // left
      plane(this.position, cross(trueUp, dirNR)),      // right
      plane(this.position, cross(right, dirNB)),       // bottom
      plane(this.position, cross(dirNT, right)),       // top
    ];
  }

  distanceToPlane(plane, p) {
    return dot(plane.normal, p) + plane.d;
  }

  // Classify an AABB: 0 = outside, 1 = intersecting, 2 = fully inside.
  classifyAABB(box) {
    let allInside = true;
    for (const plane of this.planes) {
      const p = vec3(
        plane.normal.x >= 0 ? box.max.x : box.min.x,
        plane.normal.y >= 0 ? box.max.y : box.min.y,
        plane.normal.z >= 0 ? box.max.z : box.min.z
      );
      if (this.distanceToPlane(plane, p) < 0) return 0; // fully outside this plane
      const n = vec3(
        plane.normal.x >= 0 ? box.min.x : box.max.x,
        plane.normal.y >= 0 ? box.min.y : box.max.y,
        plane.normal.z >= 0 ? box.min.z : box.max.z
      );
      if (this.distanceToPlane(plane, n) < 0) allInside = false;
    }
    return allInside ? 2 : 1;
  }

  // Brute-force visibility for one object: visible unless fully outside.
  isVisible(box) {
    return this.classifyAABB(box) !== 0;
  }
}

const MAX_DEPTH = 5;

class OctreeNode {
  constructor(box, depth) {
    this.box = box;          // cached node bounds
    this.depth = depth;
    this.children = null;    // null until subdivided
    this.staticObjects = []; // objects fully contained at this level
    this.dynamicObjects = []; // re-inserted every frame
    // Cached visibility from the last cull pass: 0 outside, 1 intersect, 2 inside.
    this.visibility = null;
    this.subtreeCount = 0;   // static objects in this subtree (cache)
  }

  childBox(index) {
    const mid = vec3(
      (this.box.min.x + this.box.max.x) / 2,
      (this.box.min.y + this.box.max.y) / 2,
      (this.box.min.z + this.box.max.z) / 2
    );
    const min = vec3(
      index & 1 ? mid.x : this.box.min.x,
      index & 2 ? mid.y : this.box.min.y,
      index & 4 ? mid.z : this.box.min.z
    );
    const max = vec3(
      index & 1 ? this.box.max.x : mid.x,
      index & 2 ? this.box.max.y : mid.y,
      index & 4 ? this.box.max.z : mid.z
    );
    return aabb(min, max);
  }

  subdivide() {
    this.children = [];
    for (let i = 0; i < 8; i++) {
      this.children.push(new OctreeNode(this.childBox(i), this.depth + 1));
    }
  }
}

export class Octree {
  constructor(rootBox, maxDepth = MAX_DEPTH) {
    this.root = new OctreeNode(rootBox, 0);
    this.maxDepth = maxDepth;
    this.dynamicTouched = new Set(); // nodes holding dynamic objects this frame
  }

  insertStatic(obj) {
    this.insertInto(this.root, obj, false);
  }

  // Dynamic objects are re-inserted into the index separately, every frame.
  reinsertDynamic(obj) {
    this.insertInto(this.root, obj, true);
  }

  clearDynamic() {
    for (const node of this.dynamicTouched) node.dynamicObjects.length = 0;
    this.dynamicTouched.clear();
  }

  insertInto(node, obj, isDynamic) {
    if (!aabbContainsBox(node.box, obj.box)) {
      // Object escapes this node's bounds: keep it at the root.
      node = this.root;
    }
    if (node.depth < this.maxDepth) {
      if (!node.children) node.subdivide();
      for (const child of node.children) {
        if (aabbContainsBox(child.box, obj.box)) {
          this.insertInto(child, obj, isDynamic);
          return;
        }
      }
    }
    if (isDynamic) {
      node.dynamicObjects.push(obj);
      this.dynamicTouched.add(node);
    } else {
      node.staticObjects.push(obj);
    }
  }

  finalizeStatic() {
    const count = (node) => {
      let total = node.staticObjects.length;
      if (node.children) {
        for (const child of node.children) total += count(child);
      }
      node.subtreeCount = total;
      return total;
    };
    count(this.root);
  }

  // Frustum culling. Only nodes intersecting the frustum are traversed;
  // nodes fully inside accept their whole subtree without child tests.
  cull(frustum) {
    const stats = {
      nodesVisited: 0,
      nodesPruned: 0,       // rejected without descending
      nodesSkippedInside: 0, // children skipped because parent fully inside
      objectsAccepted: 0,
      objectsRejected: 0,
    };
    const visible = [];

    const acceptSubtree = (node) => {
      // Whole subtree is inside: accept every object, skip all child tests.
      stats.objectsAccepted += node.staticObjects.length + node.dynamicObjects.length;
      for (const obj of node.staticObjects) visible.push(obj);
      for (const obj of node.dynamicObjects) visible.push(obj);
      if (node.children) {
        for (const child of node.children) {
          child.visibility = 2;
          stats.nodesSkippedInside++;
          acceptSubtree(child);
        }
      }
    };

    const rejectSubtree = (node) => {
      stats.objectsRejected += node.staticObjects.length + node.dynamicObjects.length;
      if (node.children) {
        for (const child of node.children) {
          child.visibility = 0;
          rejectSubtree(child);
        }
      }
    };

    const visit = (node) => {
      stats.nodesVisited++;
      const cls = frustum.classifyAABB(node.box);
      node.visibility = cls;
      if (cls === 0) {
        stats.nodesPruned++;
        rejectSubtree(node);
        return;
      }
      if (cls === 2) {
        acceptSubtree(node);
        return;
      }
      // Intersecting: test this node's own objects one by one.
      for (const obj of node.staticObjects) {
        if (frustum.isVisible(obj.box)) {
          stats.objectsAccepted++;
          visible.push(obj);
        } else {
          stats.objectsRejected++;
        }
      }
      for (const obj of node.dynamicObjects) {
        if (frustum.isVisible(obj.box)) {
          stats.objectsAccepted++;
          visible.push(obj);
        } else {
          stats.objectsRejected++;
        }
      }
      if (node.children) {
        for (const child of node.children) visit(child);
      }
    };

    visit(this.root);
    return { visible, stats };
  }
}

// Reference: test every object against the frustum individually.
export function bruteForceVisible(frustum, objects) {
  const visible = [];
  for (const obj of objects) {
    if (frustum.isVisible(obj.box)) visible.push(obj);
  }
  return visible;
}
