// Procedural test meshes. Each mesh keeps full float32 source attributes:
// positions, normals, uvs, tangent (vec3 + handedness), and indices.

export function computeAabb(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// Build per-vertex tangents and handedness from UV derivatives.
// Degenerate UV triangles fall back to an arbitrary in-plane tangent.
export function buildTangents(mesh) {
  const { positions, normals, uvs, indices } = mesh;
  const tan = Array.from({ length: positions.length / 3 }, () => [0, 0, 0]);
  const bit = Array.from({ length: positions.length / 3 }, () => [0, 0, 0]);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i], ib = indices[i + 1], ic = indices[i + 2];
    const p0 = positions.slice(3 * ia, 3 * ia + 3);
    const p1 = positions.slice(3 * ib, 3 * ib + 3);
    const p2 = positions.slice(3 * ic, 3 * ic + 3);
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const du1 = uvs[2 * ib] - uvs[2 * ia];
    const dv1 = uvs[2 * ib + 1] - uvs[2 * ia + 1];
    const du2 = uvs[2 * ic] - uvs[2 * ia];
    const dv2 = uvs[2 * ic + 1] - uvs[2 * ia + 1];
    const det = du1 * dv2 - du2 * dv1;
    let t;
    let b;
    if (Math.abs(det) < 1e-12) {
      const n = normals.slice(3 * ia, 3 * ia + 3);
      const up = Math.abs(n[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
      t = normalize3(cross3(up, n));
      b = normalize3(cross3(n, t));
    } else {
      const r = 1 / det;
      t = normalize3([
        (dv2 * e1[0] - dv1 * e2[0]) * r,
        (dv2 * e1[1] - dv1 * e2[1]) * r,
        (dv2 * e1[2] - dv1 * e2[2]) * r,
      ]);
      b = normalize3([
        (du1 * e2[0] - du2 * e1[0]) * r,
        (du1 * e2[1] - du2 * e1[1]) * r,
        (du1 * e2[2] - du2 * e1[2]) * r,
      ]);
    }
    for (const idx of [ia, ib, ic]) {
      tan[idx][0] += t[0]; tan[idx][1] += t[1]; tan[idx][2] += t[2];
      bit[idx][0] += b[0]; bit[idx][1] += b[1]; bit[idx][2] += b[2];
    }
  }
  const tangent = new Float32Array(positions.length);
  const handedness = new Int8Array(positions.length / 3);
  for (let v = 0; v < positions.length / 3; v++) {
    const n = normals.slice(3 * v, 3 * v + 3);
    let t = normalize3(tan[v]);
    // Gram-Schmidt orthogonalize against the normal.
    const dot = t[0] * n[0] + t[1] * n[1] + t[2] * n[2];
    t = normalize3([
      t[0] - dot * n[0], t[1] - dot * n[1], t[2] - dot * n[2],
    ]);
    tangent.set(t, 3 * v);
    const bAcc = normalize3(bit[v]);
    handedness[v] = dot3(bAcc, cross3(n, t)) >= 0 ? 1 : -1;
  }
  return { tangent, handedness };
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Large planar surface: quantizer step size scales with the world AABB.
export function makeLargePlane(size = 1000, seg = 24) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const x = (i / seg - 0.5) * size;
      const z = (j / seg - 0.5) * size;
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      uvs.push(i / seg, j / seg);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + 1, c = a + seg + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return finalize('large_plane', positions, normals, uvs, indices);
}

// Small object: tiny cube exercises absolute vs relative error.
export function makeSmallCube(scale = 0.01) {
  const h = scale / 2;
  const faces = [
    { n: [1, 0, 0], v: [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]] },
    { n: [-1, 0, 0], v: [[-h, -h, h], [-h, h, h], [-h, h, -h], [-h, -h, -h]] },
    { n: [0, 1, 0], v: [[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]] },
    { n: [0, -1, 0], v: [[-h, -h, h], [-h, -h, -h], [h, -h, -h], [h, -h, h]] },
    { n: [0, 0, 1], v: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], v: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },
  ];
  const positions = [], normals = [], uvs = [], indices = [];
  for (const f of faces) {
    const base = positions.length / 3;
    const cuv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    f.v.forEach((p, k) => {
      positions.push(...p); normals.push(...f.n); uvs.push(...cuv[k]);
    });
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return finalize('small_cube', positions, normals, uvs, indices);
}

// Elongated sliver triangles: one extremely thin axis exposes quantization.
export function makeSlivers(count = 64, length = 10, thickness = 1e-4) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let i = 0; i < count; i++) {
    const x0 = i * length;
    const base = positions.length / 3;
    // Triangle with a razor-thin edge along Y.
    positions.push(x0, 0, 0, x0 + length, 0, 0, x0, thickness, length * 0.5);
    const n = normalize3(cross3(
      [length, 0, 0], [0, thickness, length * 0.5]
    ));
    for (let k = 0; k < 3; k++) normals.push(...n);
    uvs.push(0, 0, 1, 0, 0, 1);
    indices.push(base, base + 1, base + 2);
  }
  return finalize('sliver_triangles', positions, normals, uvs, indices);
}

// UV seam: the same spatial corner is duplicated with UV 0 and UV 1.
export function makeUvSeamQuad() {
  const positions = [
    -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1,
    -1, 0, -1, 1, 0, 1, // duplicated edge: UV wraps 0 -> 1
  ];
  const normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1];
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 3];
  return finalize('uv_seam_quad', positions, normals, uvs, indices);
}

// UV sphere: smoothly varying normals expose octahedron angular error, and the
// duplicated seam column exercises UV-boundary preservation on curved data.
export function makeSphere(radius = 1, rings = 24, sectors = 32) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= sectors; s++) {
      const theta = (s / sectors) * 2 * Math.PI;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      positions.push(radius * nx, radius * ny, radius * nz);
      normals.push(nx, ny, nz);
      uvs.push(s / sectors, 1 - r / rings);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sectors; s++) {
      const a = r * (sectors + 1) + s;
      const b = a + sectors + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return finalize('sphere', positions, normals, uvs, indices);
}

function finalize(name, positions, normals, uvs, indices) {
  const mesh = {
    name,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
  mesh.aabb = computeAabb(mesh.positions);
  const t = buildTangents(mesh);
  mesh.tangent = t.tangent;
  mesh.handedness = t.handedness;
  return mesh;
}
