import { v3, m4, triangleArea } from './math3.js';

let nextMeshId = 1;

export class Mesh {
  constructor(name, positions, indices) {
    this.id = `mesh-${nextMeshId++}`;
    this.name = name;
    this.basePositions = positions.slice(); // undeformed, object space
    this.positions = positions.slice();     // deformed, object space
    this.indices = indices.slice();
    // Bumped whenever the index buffer / vertex count changes. Measurements
    // record this and become invalid when it no longer matches.
    this.topologyVersion = 1;
    this.deformAmount = 0;
    this.translation = [0, 0, 0];
    this.rotationY = 0;
    this.scale = [1, 1, 1];
    this.dirty = true; // GPU buffers need re-upload
  }

  get triangleCount() {
    return this.indices.length / 3;
  }

  modelMatrix() {
    return m4.multiply(
      m4.translation(...this.translation),
      m4.multiply(m4.rotationY(this.rotationY), m4.scaling(...this.scale))
    );
  }

  triVertexIndices(tri) {
    return [this.indices[tri * 3], this.indices[tri * 3 + 1], this.indices[tri * 3 + 2]];
  }

  triPositions(tri, out = []) {
    const [i0, i1, i2] = this.triVertexIndices(tri);
    const p = this.positions;
    out[0] = [p[i0 * 3], p[i0 * 3 + 1], p[i0 * 3 + 2]];
    out[1] = [p[i1 * 3], p[i1 * 3 + 1], p[i1 * 3 + 2]];
    out[2] = [p[i2 * 3], p[i2 * 3 + 1], p[i2 * 3 + 2]];
    return out;
  }

  triArea(tri) {
    const [a, b, c] = this.triPositions(tri);
    return triangleArea(a, b, c);
  }

  // Object-space point on a triangle from barycentric (u, v) -> weights (1-u-v, u, v).
  pointOnTriangle(tri, u, v) {
    const [a, b, c] = this.triPositions(tri);
    const w0 = 1 - u - v;
    return [
      a[0] * w0 + b[0] * u + c[0] * v,
      a[1] * w0 + b[1] * u + c[1] * v,
      a[2] * w0 + b[2] * u + c[2] * v,
    ];
  }

  worldPointOnTriangle(tri, u, v) {
    return m4.transformPoint(this.modelMatrix(), this.pointOnTriangle(tri, u, v));
  }

  // Sine-wave displacement along vertex normals (object space). Positions only;
  // topology (and therefore topologyVersion) is untouched, so anchors follow.
  setDeform(amount) {
    this.deformAmount = amount;
    const base = this.basePositions;
    const out = this.positions;
    const normals = computeVertexNormals(base, this.indices);
    for (let i = 0; i < base.length; i += 3) {
      const x = base[i], y = base[i + 1], z = base[i + 2];
      const wave =
        Math.sin(x * 4.0 + amount * 6.0) *
        Math.cos(z * 3.0 + amount * 4.0) *
        amount * 0.25;
      out[i] = x + normals[i] * wave;
      out[i + 1] = y + normals[i + 1] * wave;
      out[i + 2] = z + normals[i + 2] * wave;
    }
    this.dirty = true;
  }

  // One edge-split subdivision pass. Changes topology -> bumps topologyVersion,
  // which invalidates existing measurements instead of silently re-pointing them.
  subdivide() {
    const pos = this.basePositions.slice();
    const idx = this.indices;
    const midCache = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (midCache.has(key)) return midCache.get(key);
      const vi = pos.length / 3;
      for (let k = 0; k < 3; k++)
        pos.push((pos[a * 3 + k] + pos[b * 3 + k]) / 2);
      midCache.set(key, vi);
      return vi;
    };
    const next = [];
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    this.basePositions = pos;
    this.indices = next;
    this.topologyVersion++;
    this.setDeform(this.deformAmount);
  }

  // Collapse the first triangle's vertices onto one point (degenerate, area 0).
  collapseFirstTriangle() {
    if (this.indices.length < 3) return;
    const [i0, i1, i2] = [this.indices[0], this.indices[1], this.indices[2]];
    for (let k = 0; k < 3; k++) {
      const v = this.basePositions[i0 * 3 + k];
      this.basePositions[i1 * 3 + k] = v;
      this.basePositions[i2 * 3 + k] = v;
    }
    this.setDeform(this.deformAmount);
  }

  // Vertex adjacency with edge lengths, for the along-surface (geodesic) estimate.
  buildEdgeGraph() {
    const n = this.basePositions.length / 3;
    const adj = Array.from({ length: n }, () => []);
    const pos = this.positions;
    const dist = (a, b) =>
      Math.hypot(
        pos[a * 3] - pos[b * 3],
        pos[a * 3 + 1] - pos[b * 3 + 1],
        pos[a * 3 + 2] - pos[b * 3 + 2]
      );
    const seen = new Set();
    for (let t = 0; t < this.indices.length; t += 3) {
      const tri = [this.indices[t], this.indices[t + 1], this.indices[t + 2]];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const d = dist(a, b);
        adj[a].push([b, d]);
        adj[b].push([a, d]);
      }
    }
    return adj;
  }
}

export function computeVertexNormals(positions, indices) {
  const normals = new Float64Array(positions.length).fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const [i0, i1, i2] = [indices[t], indices[t + 1], indices[t + 2]];
    const a = positions.slice(i0 * 3, i0 * 3 + 3);
    const b = positions.slice(i1 * 3, i1 * 3 + 3);
    const c = positions.slice(i2 * 3, i2 * 3 + 3);
    const n = v3.cross(v3.sub(b, a), v3.sub(c, a));
    for (const i of [i0, i1, i2])
      for (let k = 0; k < 3; k++) normals[i * 3 + k] += n[k];
  }
  for (let i = 0; i < normals.length; i += 3) {
    const n = v3.normalize([normals[i], normals[i + 1], normals[i + 2]]);
    normals[i] = n[0]; normals[i + 1] = n[1]; normals[i + 2] = n[2];
  }
  return normals;
}
