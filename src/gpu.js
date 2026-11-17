// Convert quad records into WebGL2-ready typed-array buffers.
// Interleaved vertex: position vec3, normal vec3, color vec3 (9 floats).
// Indices are Uint32 so large merged scenes stay in one draw call.

export const DEFAULT_PALETTE = [
  [0.78, 0.74, 0.66],
  [0.86, 0.45, 0.32],
  [0.36, 0.62, 0.82],
  [0.48, 0.72, 0.42],
  [0.85, 0.72, 0.3],
  [0.62, 0.45, 0.74],
  [0.3, 0.78, 0.74],
];

const AXIS_VECTORS = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export function colorForMaterial(material, palette = DEFAULT_PALETTE) {
  return palette[(material - 1) % palette.length];
}

export function buildGPUMesh(quads, palette = DEFAULT_PALETTE) {
  const vertices = new Float32Array(quads.length * 4 * 9);
  const indices = new Uint32Array(quads.length * 6);
  let v = 0;
  let i = 0;
  let vertexBase = 0;

  for (const quad of quads) {
    const d = quad.d;
    const u = (d + 1) % 3;
    const vAxis = (d + 2) % 3;
    const normal = AXIS_VECTORS[d].map((n) => n * quad.sign);
    const color = colorForMaterial(quad.material, palette);
    const corners = [
      [quad.x, quad.y, quad.z],
      [quad.x, quad.y, quad.z],
      [quad.x, quad.y, quad.z],
      [quad.x, quad.y, quad.z],
    ];
    corners[1][u] += quad.w;
    corners[2][u] += quad.w;
    corners[2][vAxis] += quad.h;
    corners[3][vAxis] += quad.h;

    // Consistent outward winding: CCW seen from outside for both signs.
    let order;
    if (quad.sign === 1) order = [0, 1, 2, 3];
    else order = [0, 3, 2, 1];

    for (const cornerIndex of order) {
      const corner = corners[cornerIndex];
      vertices[v++] = corner[0];
      vertices[v++] = corner[1];
      vertices[v++] = corner[2];
      vertices[v++] = normal[0];
      vertices[v++] = normal[1];
      vertices[v++] = normal[2];
      vertices[v++] = color[0];
      vertices[v++] = color[1];
      vertices[v++] = color[2];
    }
    indices[i++] = vertexBase;
    indices[i++] = vertexBase + 1;
    indices[i++] = vertexBase + 2;
    indices[i++] = vertexBase;
    indices[i++] = vertexBase + 2;
    indices[i++] = vertexBase + 3;
    vertexBase += 4;
  }
  return {
    vertices,
    indices,
    strideFloats: 9,
    vertexCount: quads.length * 4,
    indexCount: quads.length * 6,
  };
}

// Expand merged quads back to unit faces and compare surfaces.
// Returns true when both meshes cover exactly the same oriented unit
// faces (same plane, same normal direction and same material).
export function sameSurface(referenceQuads, mergedQuads) {
  const keyOf = (d, sign, x, y, z, material) =>
    `${d}|${sign}|${x}|${y}|${z}|${material}`;
  const expand = (quads) => {
    const set = new Set();
    for (const q of quads) {
      const u = (q.d + 1) % 3;
      const v = (q.d + 2) % 3;
      for (let h = 0; h < q.h; h++) {
        for (let w = 0; w < q.w; w++) {
          const corner = [q.x, q.y, q.z];
          const base = [q.x, q.y, q.z];
          corner[u] = base[u] + w;
          corner[v] = base[v] + h;
          set.add(keyOf(q.d, q.sign, corner[0], corner[1], corner[2], q.material));
        }
      }
    }
    return set;
  };
  const a = expand(referenceQuads);
  const b = expand(mergedQuads);
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}
