import {
  CUBE_CORNERS,
  CUBE_EDGES,
  cellIsActive,
  readCell,
} from "./grid.js";
import { surfaceNormal } from "./fields.js";

const EPSILON = 1e-8;

export function extractSurfaceNets(grid, options = {}) {
  const started = performance.now();
  const { iso } = grid;
  const n = grid.resolution;
  const cells = grid.cellCount;
  const cellVertices = new Int32Array(cells ** 3);
  cellVertices.fill(-1);
  const positions = [];
  const normals = [];
  const cell = new Float32Array(8);
  let activeCells = 0;

  for (let k = 0; k < cells; k += 1) {
    for (let j = 0; j < cells; j += 1) {
      for (let i = 0; i < cells; i += 1) {
        readCell(grid, i, j, k, cell);
        if (!cellIsActive(cell, iso)) continue;
        activeCells += 1;

        const local = averageEdgeCrossings(cell, iso);
        if (!local) continue;
        const worldX = grid.origin + (i + local[0]) * grid.step;
        const worldY = grid.origin + (j + local[1]) * grid.step;
        const worldZ = grid.origin + (k + local[2]) * grid.step;
        const vertex = positions.length / 3;
        cellVertices[grid.cellIndex(i, j, k)] = vertex;
        positions.push(worldX, worldY, worldZ);
        normals.push(...surfaceNormal(grid.field, worldX, worldY, worldZ));
      }
    }
  }

  const quads = [];
  const neighbors = Array.from(
    { length: positions.length / 3 },
    () => new Set(),
  );
  let duplicateQuads = 0;
  const seenFaces = new Set();

  const addQuad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (a === b || a === c || a === d || b === c || b === d || c === d) return;
    const ordered = orientQuad(positions, normals, [a, b, c, d]);
    if (!ordered) return;
    const key = [...ordered].sort((x, y) => x - y).join(":");
    if (seenFaces.has(key)) {
      duplicateQuads += 1;
      return;
    }
    seenFaces.add(key);
    quads.push(...ordered);
    for (let edge = 0; edge < 4; edge += 1) {
      neighbors[ordered[edge]].add(ordered[(edge + 1) % 4]);
      neighbors[ordered[(edge + 1) % 4]].add(ordered[edge]);
    }
  };

  for (let k = 1; k < cells; k += 1) {
    for (let j = 1; j < cells; j += 1) {
      for (let i = 0; i < n - 1; i += 1) {
        const a = sampleValue(grid, i, j, k);
        const b = sampleValue(grid, i + 1, j, k);
        if (!crosses(a, b, iso)) continue;
        addQuad(
          cellVertex(grid, cellVertices, i, j - 1, k - 1),
          cellVertex(grid, cellVertices, i, j, k - 1),
          cellVertex(grid, cellVertices, i, j, k),
          cellVertex(grid, cellVertices, i, j - 1, k),
        );
      }
    }
  }

  for (let k = 1; k < cells; k += 1) {
    for (let j = 0; j < n - 1; j += 1) {
      for (let i = 1; i < cells; i += 1) {
        const a = sampleValue(grid, i, j, k);
        const b = sampleValue(grid, i, j + 1, k);
        if (!crosses(a, b, iso)) continue;
        addQuad(
          cellVertex(grid, cellVertices, i - 1, j, k - 1),
          cellVertex(grid, cellVertices, i - 1, j, k),
          cellVertex(grid, cellVertices, i, j, k),
          cellVertex(grid, cellVertices, i, j, k - 1),
        );
      }
    }
  }

  for (let k = 0; k < n - 1; k += 1) {
    for (let j = 1; j < cells; j += 1) {
      for (let i = 1; i < cells; i += 1) {
        const a = sampleValue(grid, i, j, k);
        const b = sampleValue(grid, i, j, k + 1);
        if (!crosses(a, b, iso)) continue;
        addQuad(
          cellVertex(grid, cellVertices, i - 1, j - 1, k),
          cellVertex(grid, cellVertices, i, j - 1, k),
          cellVertex(grid, cellVertices, i, j, k),
          cellVertex(grid, cellVertices, i - 1, j, k),
        );
      }
    }
  }

  const smoothing = clamp(options.smoothing ?? 0.5, 0, 0.9);
  const passes = smoothing > 0 ? (options.smoothingPasses ?? 2) : 0;
  smoothPositions(positions, neighbors, smoothing, passes);
  recomputeAnalyticNormals(grid.field, positions, normals);
  repairZeroNormals(positions, quads, normals);

  const indices = new Uint32Array(quads.length / 4 * 6);
  let cursor = 0;
  for (let face = 0; face < quads.length; face += 4) {
    const a = quads[face];
    const b = quads[face + 1];
    const c = quads[face + 2];
    const d = quads[face + 3];
    indices[cursor++] = a;
    indices[cursor++] = b;
    indices[cursor++] = c;
    indices[cursor++] = a;
    indices[cursor++] = c;
    indices[cursor++] = d;
  }

  return {
    kind: "surface-nets",
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    faces: new Uint32Array(quads),
    quads: new Uint32Array(quads),
    indices,
    vertexCount: positions.length / 3,
    faceCount: quads.length / 4,
    triangleCount: indices.length / 3,
    activeCells,
    duplicateQuads,
    smoothing,
    smoothingPasses: passes,
    resolution: n,
    iso,
    extent: grid.extent,
    step: grid.step,
    timings: { total: performance.now() - started },
  };
}

function averageEdgeCrossings(cell, iso) {
  let x = 0;
  let y = 0;
  let z = 0;
  let crossings = 0;

  for (const [edgeA, edgeB] of CUBE_EDGES) {
    const valueA = cell[edgeA];
    const valueB = cell[edgeB];
    if (!crosses(valueA, valueB, iso)) continue;
    const denominator = valueB - valueA;
    const t = Math.abs(denominator) < EPSILON
      ? 0.5
      : clamp((iso - valueA) / denominator, 0, 1);
    const a = CUBE_CORNERS[edgeA];
    const b = CUBE_CORNERS[edgeB];
    x += a[0] + (b[0] - a[0]) * t;
    y += a[1] + (b[1] - a[1]) * t;
    z += a[2] + (b[2] - a[2]) * t;
    crossings += 1;
  }

  return crossings > 0 ? [x / crossings, y / crossings, z / crossings] : null;
}

function orientQuad(positions, normals, indices) {
  const [a, b, c] = indices;
  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const ux = positions[b * 3] - ax;
  const uy = positions[b * 3 + 1] - ay;
  const uz = positions[b * 3 + 2] - az;
  const vx = positions[c * 3] - ax;
  const vy = positions[c * 3 + 1] - ay;
  const vz = positions[c * 3 + 2] - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx * nx + ny * ny + nz * nz < 1e-16) return null;

  let referenceX = 0;
  let referenceY = 0;
  let referenceZ = 0;
  for (const index of indices) {
    referenceX += normals[index * 3];
    referenceY += normals[index * 3 + 1];
    referenceZ += normals[index * 3 + 2];
  }
  if (nx * referenceX + ny * referenceY + nz * referenceZ < 0) {
    return [indices[0], indices[3], indices[2], indices[1]];
  }
  return indices;
}

function smoothPositions(positions, neighbors, smoothing, passes) {
  if (smoothing <= 0 || passes <= 0) return;
  const count = positions.length / 3;
  let source = Float64Array.from(positions);
  let target = new Float64Array(positions.length);

  for (let pass = 0; pass < passes; pass += 1) {
    for (let vertex = 0; vertex < count; vertex += 1) {
      const adjacent = neighbors[vertex];
      if (adjacent.size === 0) {
        target[vertex * 3] = source[vertex * 3];
        target[vertex * 3 + 1] = source[vertex * 3 + 1];
        target[vertex * 3 + 2] = source[vertex * 3 + 2];
        continue;
      }
      let x = 0;
      let y = 0;
      let z = 0;
      for (const neighbor of adjacent) {
        x += source[neighbor * 3];
        y += source[neighbor * 3 + 1];
        z += source[neighbor * 3 + 2];
      }
      const inverse = 1 / adjacent.size;
      target[vertex * 3] = lerp(source[vertex * 3], x * inverse, smoothing);
      target[vertex * 3 + 1] = lerp(source[vertex * 3 + 1], y * inverse, smoothing);
      target[vertex * 3 + 2] = lerp(source[vertex * 3 + 2], z * inverse, smoothing);
    }
    [source, target] = [target, source];
  }

  for (let i = 0; i < positions.length; i += 1) positions[i] = source[i];
}

function recomputeAnalyticNormals(field, positions, normals) {
  for (let i = 0; i < positions.length; i += 3) {
    const normal = surfaceNormal(
      field,
      positions[i],
      positions[i + 1],
      positions[i + 2],
    );
    normals[i] = normal[0];
    normals[i + 1] = normal[1];
    normals[i + 2] = normal[2];
  }
}

function repairZeroNormals(positions, quads, normals) {
  const accumulated = new Float32Array(normals.length);
  for (let face = 0; face < quads.length; face += 4) {
    const a = quads[face];
    const b = quads[face + 1];
    const c = quads[face + 2];
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax;
    const uy = positions[b * 3 + 1] - ay;
    const uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax;
    const vy = positions[c * 3 + 1] - ay;
    const vz = positions[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const vertex of [a, b, c, quads[face + 3]]) {
      accumulated[vertex * 3] += nx;
      accumulated[vertex * 3 + 1] += ny;
      accumulated[vertex * 3 + 2] += nz;
    }
  }

  for (let offset = 0; offset < normals.length; offset += 3) {
    const length = Math.hypot(
      normals[offset],
      normals[offset + 1],
      normals[offset + 2],
    );
    if (length > 1e-6) continue;
    const fallback = Math.hypot(
      accumulated[offset],
      accumulated[offset + 1],
      accumulated[offset + 2],
    );
    if (fallback < 1e-12) continue;
    normals[offset] = accumulated[offset] / fallback;
    normals[offset + 1] = accumulated[offset + 1] / fallback;
    normals[offset + 2] = accumulated[offset + 2] / fallback;
  }
}

function sampleValue(grid, i, j, k) {
  return grid.values[grid.sampleIndex(i, j, k)];
}

function cellVertex(grid, cellVertices, i, j, k) {
  if (i < 0 || j < 0 || k < 0 || i >= grid.cellCount || j >= grid.cellCount || k >= grid.cellCount) {
    return -1;
  }
  return cellVertices[grid.cellIndex(i, j, k)];
}

function crosses(a, b, iso) {
  return (a > iso) !== (b > iso);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
