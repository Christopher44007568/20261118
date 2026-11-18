export const SCENE = Object.freeze({
  lowExtents: [0.66, 0.54, 0.8],
  highExtents: [0.83, 0.69, 0.99],
  roundRadius: 0.16,
  atlasColumns: 3,
  atlasRows: 2,
  gutter: 0.024,
});

const FACE_DEFS = [
  { normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { normal: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { normal: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

function axisExtent(extents, normal) {
  const axis = normal[0] !== 0 ? 0 : normal[1] !== 0 ? 1 : 2;
  return extents[axis];
}

function scaled(vec, scale) {
  return [vec[0] * scale, vec[1] * scale, vec[2] * scale];
}

function add3(a, b, c, d) {
  return [
    a[0] + b[0] + c[0] + d[0],
    a[1] + b[1] + c[1] + d[1],
    a[2] + b[2] + c[2] + d[2],
  ];
}

export function buildLowMesh() {
  const extents = SCENE.lowExtents;
  const positions = [];
  const normals = [];
  const tangents = [];
  const bitangents = [];
  const uvs = [];
  const indices = [];
  const cellW = 1 / SCENE.atlasColumns;
  const cellH = 1 / SCENE.atlasRows;
  const gutter = SCENE.gutter;

  for (let face = 0; face < FACE_DEFS.length; face++) {
    const def = FACE_DEFS[face];
    const normalOffset = scaled(def.normal, axisExtent(extents, def.normal));
    const uExtent = axisExtent(extents, def.u);
    const vExtent = axisExtent(extents, def.v);
    const uOffset = scaled(def.u, uExtent);
    const vOffset = scaled(def.v, vExtent);
    const center = add3([0, 0, 0], normalOffset, [0, 0, 0], [0, 0, 0]);
    const corners = [
      add3(center, scaled(uOffset, -1), scaled(vOffset, -1), [0, 0, 0]),
      add3(center, uOffset, scaled(vOffset, -1), [0, 0, 0]),
      add3(center, uOffset, vOffset, [0, 0, 0]),
      add3(center, scaled(uOffset, -1), vOffset, [0, 0, 0]),
    ];
    const col = face % SCENE.atlasColumns;
    const row = Math.floor(face / SCENE.atlasColumns);
    const u0 = col * cellW + gutter;
    const u1 = (col + 1) * cellW - gutter;
    const v0 = row * cellH + gutter;
    const v1 = (row + 1) * cellH - gutter;
    const base = positions.length / 3;

    corners.forEach((corner, cornerIndex) => {
      positions.push(...corner);
      normals.push(...def.normal);
      tangents.push(...def.u);
      bitangents.push(...def.v);
      uvs.push(cornerIndex === 1 || cornerIndex === 2 ? u1 : u0);
      uvs.push(cornerIndex >= 2 ? v1 : v0);
    });
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    tangents: new Float32Array(tangents),
    bitangents: new Float32Array(bitangents),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

export function makeCagePositions(lowMesh, offset) {
  const { positions } = lowMesh;
  const extents = SCENE.lowExtents;
  const cage = new Float32Array(positions.length);
  const areaX = extents[1] * extents[2];
  const areaY = extents[0] * extents[2];
  const areaZ = extents[0] * extents[1];

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    let nx = Math.sign(x) * areaX;
    let ny = Math.sign(y) * areaY;
    let nz = Math.sign(z) * areaZ;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    cage[i] = x + nx * offset;
    cage[i + 1] = y + ny * offset;
    cage[i + 2] = z + nz * offset;
  }
  return cage;
}

export function buildHardBoxHighMesh() {
  const extents = SCENE.highExtents;
  const positions = [];
  const normals = [];
  const indices = [];

  for (const def of FACE_DEFS) {
    const normalOffset = scaled(def.normal, axisExtent(extents, def.normal));
    const uOffset = scaled(def.u, axisExtent(extents, def.u));
    const vOffset = scaled(def.v, axisExtent(extents, def.v));
    const corners = [
      add3(normalOffset, scaled(uOffset, -1), scaled(vOffset, -1), [0, 0, 0]),
      add3(normalOffset, uOffset, scaled(vOffset, -1), [0, 0, 0]),
      add3(normalOffset, uOffset, vOffset, [0, 0, 0]),
      add3(normalOffset, scaled(uOffset, -1), vOffset, [0, 0, 0]),
    ];
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      normals.push(...def.normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mapRoundedPoint(point, innerExtents, radius) {
  const cx = clamp(point[0], -innerExtents[0], innerExtents[0]);
  const cy = clamp(point[1], -innerExtents[1], innerExtents[1]);
  const cz = clamp(point[2], -innerExtents[2], innerExtents[2]);
  let dx = point[0] - cx;
  let dy = point[1] - cy;
  let dz = point[2] - cz;
  let length = Math.hypot(dx, dy, dz);
  if (length < 1e-8) {
    dx = 0;
    dy = 0;
    dz = 0;
    length = 1;
  }
  const nx = dx / length;
  const ny = dy / length;
  const nz = dz / length;
  return {
    position: [cx + nx * radius, cy + ny * radius, cz + nz * radius],
    normal: [nx, ny, nz],
  };
}

export function buildRoundedHighMesh(segments = 40) {
  const extents = SCENE.highExtents;
  const radius = SCENE.roundRadius;
  const innerExtents = extents.map((value) => value - radius);
  const positions = [];
  const normals = [];
  const indices = [];

  for (const def of FACE_DEFS) {
    const normalOffset = scaled(def.normal, axisExtent(extents, def.normal));
    const uExtent = axisExtent(extents, def.u);
    const vExtent = axisExtent(extents, def.v);
    const base = positions.length / 3;
    const stride = segments + 1;
    for (let iy = 0; iy <= segments; iy++) {
      const tv = iy / segments;
      const vCoord = -vExtent + 2 * vExtent * tv;
      for (let ix = 0; ix <= segments; ix++) {
        const tu = ix / segments;
        const uCoord = -uExtent + 2 * uExtent * tu;
        const p = [
          normalOffset[0] + def.u[0] * uCoord + def.v[0] * vCoord,
          normalOffset[1] + def.u[1] * uCoord + def.v[1] * vCoord,
          normalOffset[2] + def.u[2] * uCoord + def.v[2] * vCoord,
        ];
        const mapped = mapRoundedPoint(p, innerExtents, radius);
        positions.push(...mapped.position);
        normals.push(...mapped.normal);
      }
    }
    for (let iy = 0; iy < segments; iy++) {
      for (let ix = 0; ix < segments; ix++) {
        const a = base + iy * stride + ix;
        const b = a + 1;
        const c = a + stride + 1;
        const d = a + stride;
        indices.push(a, b, c, a, c, d);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

export function buildScenarios(roundedSegments = 40) {
  const low = buildLowMesh();
  return {
    low,
    hard: {
      id: "hard",
      label: "硬边箱体",
      high: buildHardBoxHighMesh(),
    },
    rounded: {
      id: "rounded",
      label: "圆角箱体",
      high: buildRoundedHighMesh(roundedSegments),
    },
  };
}
