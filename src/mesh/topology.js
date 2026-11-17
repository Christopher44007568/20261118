import { meshBounds } from './box.js';

function weldVertices(positions, triangleIndices, tolerance) {
  const unique = [];
  const remap = new Uint32Array(positions.length / 3);
  const cells = new Map();
  const toleranceSquared = tolerance * tolerance;

  for (let source = 0; source < remap.length; source += 1) {
    const x = positions[source * 3];
    const y = positions[source * 3 + 1];
    const z = positions[source * 3 + 2];
    const cx = Math.floor(x / tolerance);
    const cy = Math.floor(y / tolerance);
    const cz = Math.floor(z / tolerance);
    let match = -1;

    for (let dx = -1; dx <= 1 && match < 0; dx += 1) {
      for (let dy = -1; dy <= 1 && match < 0; dy += 1) {
        for (let dz = -1; dz <= 1 && match < 0; dz += 1) {
          const bucket = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const candidate of bucket) {
            const px = unique[candidate * 3];
            const py = unique[candidate * 3 + 1];
            const pz = unique[candidate * 3 + 2];
            const distance =
              (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
            if (distance <= toleranceSquared) {
              match = candidate;
              break;
            }
          }
        }
      }
    }

    if (match < 0) {
      match = unique.length / 3;
      unique.push(x, y, z);
      const key = `${cx},${cy},${cz}`;
      const bucket = cells.get(key) ?? [];
      bucket.push(match);
      cells.set(key, bucket);
    }
    remap[source] = match;
  }

  const triangles = new Uint32Array(triangleIndices.length);
  for (let i = 0; i < triangleIndices.length; i += 1) {
    triangles[i] = remap[triangleIndices[i]];
  }
  return { positions: new Float32Array(unique), triangles, remap };
}

function triangleAreaSquared(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return nx * nx + ny * ny + nz * nz;
}

export function inspectTopology(mesh) {
  const vertexCount = mesh.positions.length / 3;
  const triangleCount = mesh.indices.length / 3;
  const empty = triangleCount === 0;
  const bounds = meshBounds(mesh);
  const diagonal = bounds
    ? Math.hypot(
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
      )
    : 1;
  const tolerance = Math.max(diagonal * 1e-7, 1e-7);
  const welded = weldVertices(mesh.positions, mesh.indices, tolerance);
  const edges = new Map();
  let degenerateTriangles = 0;
  let signedVolume = 0;
  const areaEpsilon = tolerance * tolerance;

  for (let i = 0; i < welded.triangles.length; i += 3) {
    const ia = welded.triangles[i];
    const ib = welded.triangles[i + 1];
    const ic = welded.triangles[i + 2];
    const ax = welded.positions[ia * 3];
    const ay = welded.positions[ia * 3 + 1];
    const az = welded.positions[ia * 3 + 2];
    const bx = welded.positions[ib * 3];
    const by = welded.positions[ib * 3 + 1];
    const bz = welded.positions[ib * 3 + 2];
    const cx = welded.positions[ic * 3];
    const cy = welded.positions[ic * 3 + 1];
    const cz = welded.positions[ic * 3 + 2];
    const areaSquared = triangleAreaSquared(
      ax, ay, az, bx, by, bz, cx, cy, cz,
    );
    if (ia === ib || ib === ic || ic === ia || areaSquared <= areaEpsilon) {
      degenerateTriangles += 1;
    }
    signedVolume += (
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx)
    );

    for (const [from, to] of [[ia, ib], [ib, ic], [ic, ia]]) {
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      const key = `${low}:${high}`;
      const edge = edges.get(key) ?? { total: 0, forward: 0, reverse: 0 };
      edge.total += 1;
      if (from === low) edge.forward += 1;
      else edge.reverse += 1;
      edges.set(key, edge);
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let orientationConflicts = 0;
  for (const edge of edges.values()) {
    if (edge.total === 1) boundaryEdges += 1;
    if (edge.total > 2) nonManifoldEdges += 1;
    if (edge.total === 2 && (edge.forward !== 1 || edge.reverse !== 1)) {
      orientationConflicts += 1;
    }
  }

  const closed = empty || (
    boundaryEdges === 0 &&
    nonManifoldEdges === 0 &&
    orientationConflicts === 0 &&
    degenerateTriangles === 0
  );
  const outward = empty || signedVolume > -Math.max(diagonal ** 3 * 1e-8, 1e-9);

  return {
    vertexCount,
    weldedVertexCount: welded.positions.length / 3,
    triangleCount,
    edgeCount: edges.size,
    boundaryEdges,
    nonManifoldEdges,
    orientationConflicts,
    degenerateTriangles,
    signedVolume: signedVolume / 6,
    closed,
    outward,
    empty,
    bounds,
  };
}
