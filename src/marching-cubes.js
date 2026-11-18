import { edgeTable, triTable } from "three/addons/objects/MarchingCubes.js";
import {
  CUBE_CORNERS,
  CUBE_EDGES,
  cellIsActive,
  readCell,
} from "./grid.js";
import { surfaceNormal } from "./fields.js";

const EPSILON = 1e-8;

export function extractMarchingCubes(grid, options = {}) {
  const started = performance.now();
  const { iso } = grid;
  const n = grid.resolution;
  const cells = grid.cellCount;
  const stride = n ** 3;
  const edgeVertices = new Int32Array(stride * 3);
  edgeVertices.fill(-1);
  const positions = [];
  const normals = [];
  const triangles = [];
  const cell = new Float32Array(8);
  const seenFaces = new Set();
  let activeCells = 0;
  let duplicateFaces = 0;
  let degenerateFaces = 0;

  for (let k = 0; k < cells; k += 1) {
    for (let j = 0; j < cells; j += 1) {
      for (let i = 0; i < cells; i += 1) {
        readCell(grid, i, j, k, cell);
        if (!cellIsActive(cell, iso)) continue;
        activeCells += 1;
        let cubeIndex = 0;
        for (let corner = 0; corner < 8; corner += 1) {
          if (cell[corner] > iso) cubeIndex |= 1 << corner;
        }
        if (edgeTable[cubeIndex] === 0) continue;
        const tableOffset = cubeIndex * 16;

        for (let cursor = 0; cursor < 16; cursor += 3) {
          const edgeA = triTable[tableOffset + cursor];
          if (edgeA === -1) break;
          const edgeB = triTable[tableOffset + cursor + 1];
          const edgeC = triTable[tableOffset + cursor + 2];
          let a = edgeVertex(grid, edgeVertices, positions, normals, cell, i, j, k, edgeA, iso);
          let b = edgeVertex(grid, edgeVertices, positions, normals, cell, i, j, k, edgeB, iso);
          let c = edgeVertex(grid, edgeVertices, positions, normals, cell, i, j, k, edgeC, iso);
          if (a === b || b === c || c === a) {
            degenerateFaces += 1;
            continue;
          }
          const orientation = faceOrientation(positions, normals, a, b, c);
          if (orientation.area < 1e-12) {
            degenerateFaces += 1;
            continue;
          }
          if (orientation.dot < 0) [b, c] = [c, b];
          const key = [a, b, c].sort((x, y) => x - y).join(":");
          if (seenFaces.has(key)) {
            duplicateFaces += 1;
            continue;
          }
          seenFaces.add(key);
          triangles.push(a, b, c);
        }
      }
    }
  }

  return {
    kind: "marching-cubes",
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(triangles),
    faces: new Uint32Array(triangles),
    vertexCount: positions.length / 3,
    faceCount: triangles.length / 3,
    triangleCount: triangles.length / 3,
    activeCells,
    duplicateFaces,
    degenerateFaces,
    resolution: n,
    iso,
    extent: grid.extent,
    step: grid.step,
    timings: { total: performance.now() - started },
  };
}

function edgeVertex(grid, cache, positions, normals, cell, i, j, k, edgeIndex, iso) {
  const [cornerA, cornerB] = CUBE_EDGES[edgeIndex];
  const a = CUBE_CORNERS[cornerA];
  const b = CUBE_CORNERS[cornerB];
  const axis = a[0] !== b[0] ? 0 : a[1] !== b[1] ? 1 : 2;
  const startX = i + Math.min(a[0], b[0]);
  const startY = j + Math.min(a[1], b[1]);
  const startZ = k + Math.min(a[2], b[2]);
  const key = axis * (grid.resolution ** 3)
    + startX
    + grid.resolution * (startY + grid.resolution * startZ);
  const cached = cache[key];
  if (cached >= 0) return cached;

  const valueA = cell[cornerA];
  const valueB = cell[cornerB];
  const denominator = valueB - valueA;
  const t = Math.abs(denominator) < EPSILON
    ? 0.5
    : clamp((iso - valueA) / denominator, 0, 1);
  const gx = startX + t * (axis === 0 ? 1 : 0);
  const gy = startY + t * (axis === 1 ? 1 : 0);
  const gz = startZ + t * (axis === 2 ? 1 : 0);
  const x = grid.origin + gx * grid.step;
  const y = grid.origin + gy * grid.step;
  const z = grid.origin + gz * grid.step;
  const index = positions.length / 3;
  positions.push(x, y, z);
  normals.push(...surfaceNormal(grid.field, x, y, z));
  cache[key] = index;
  return index;
}

function faceOrientation(positions, normals, a, b, c) {
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
  const averageX = normals[a * 3] + normals[b * 3] + normals[c * 3];
  const averageY = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1];
  const averageZ = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2];
  return {
    area: Math.hypot(nx, ny, nz) * 0.5,
    dot: nx * averageX + ny * averageY + nz * averageZ,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
