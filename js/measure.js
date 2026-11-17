import { v3 } from './math3.js';

export const DEGENERATE_AREA_EPS = 1e-10;

let nextMeasurementId = 1;

// An anchor is a surface attachment: mesh id + triangle index + barycentric
// coords + the topology version it was captured against.
export function createAnchor(mesh, triIndex, u, v) {
  return {
    meshId: mesh.id,
    triIndex,
    u,
    v,
    topologyVersion: mesh.topologyVersion,
  };
}

// Returns { ok: true, position } or { ok: false, reason }.
// Never silently re-points an anchor at a different triangle: a topology
// version mismatch or a degenerate triangle is reported as invalid.
export function resolveAnchor(anchor, mesh) {
  if (!mesh || mesh.id !== anchor.meshId)
    return { ok: false, reason: '网格不存在' };
  if (mesh.topologyVersion !== anchor.topologyVersion)
    return { ok: false, reason: `拓扑已变更 (v${anchor.topologyVersion} -> v${mesh.topologyVersion})` };
  if (anchor.triIndex < 0 || anchor.triIndex >= mesh.triangleCount)
    return { ok: false, reason: '三角形索引越界' };
  if (mesh.triArea(anchor.triIndex) < DEGENERATE_AREA_EPS)
    return { ok: false, reason: '三角形已退化' };
  return {
    ok: true,
    position: mesh.worldPointOnTriangle(anchor.triIndex, anchor.u, anchor.v),
  };
}

export function createMeasurement(anchorA, anchorB) {
  return {
    id: nextMeasurementId++,
    a: anchorA,
    b: anchorB,
  };
}

// Straight-line (Euclidean) world-space distance between two anchors.
export function straightDistance(measurement, meshById) {
  const ra = resolveAnchor(measurement.a, meshById.get(measurement.a.meshId));
  const rb = resolveAnchor(measurement.b, meshById.get(measurement.b.meshId));
  if (!ra.ok || !rb.ok) return null;
  return v3.distance(ra.position, rb.position);
}

// Approximate along-surface (geodesic) distance: Dijkstra over the mesh edge
// graph between the two anchor triangles' vertices, plus in-triangle offsets.
// Only defined when both anchors live on the same mesh; returns null otherwise.
export function surfaceDistance(measurement, meshById) {
  const { a, b } = measurement;
  if (a.meshId !== b.meshId) return null;
  const mesh = meshById.get(a.meshId);
  const ra = resolveAnchor(a, mesh);
  const rb = resolveAnchor(b, mesh);
  if (!ra.ok || !rb.ok) return null;

  const pa = mesh.pointOnTriangle(a.triIndex, a.u, a.v);
  const pb = mesh.pointOnTriangle(b.triIndex, b.u, b.v);
  const vertsA = mesh.triVertexIndices(a.triIndex);
  const vertsB = mesh.triVertexIndices(b.triIndex);
  const vertPos = (vi) => [
    mesh.positions[vi * 3],
    mesh.positions[vi * 3 + 1],
    mesh.positions[vi * 3 + 2],
  ];

  const adj = mesh.buildEdgeGraph();

  // Object-space path length, then scaled by the model matrix's mean scale
  // factor so it stays comparable to world-space straight distance.
  // Run Dijkstra once per source vertex so each candidate path keeps a
  // consistent start vertex (multi-source distances would mix starts and
  // could undercut the true path length).
  let best = Infinity;
  for (const va of vertsA) {
    const dist = dijkstra(adj, [va]);
    const offA = v3.distance(pa, vertPos(va));
    for (const vb of vertsB) {
      const dvb = dist.get(vb);
      if (!isFinite(dvb)) continue;
      const total = offA + dvb + v3.distance(vertPos(vb), pb);
      if (total < best) best = total;
    }
  }
  if (!isFinite(best)) return null;
  return best * meanScale(mesh.scale);
}

function dijkstra(adj, sources) {
  const dist = new Map();
  const heap = [];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };
  for (const s of sources) {
    dist.set(s, 0);
    push([0, s]);
  }
  while (heap.length) {
    const [d, u] = pop();
    if (d > (dist.get(u) ?? Infinity)) continue;
    for (const [w, len] of adj[u]) {
      const nd = d + len;
      if (nd < (dist.get(w) ?? Infinity)) {
        dist.set(w, nd);
        push([nd, w]);
      }
    }
  }
  return dist;
}

function meanScale(scale) {
  // For non-uniform scale there is no single exact factor; the average of the
  // three axis scales is a reasonable approximation for display purposes.
  return (Math.abs(scale[0]) + Math.abs(scale[1]) + Math.abs(scale[2])) / 3;
}

export function serializeMeasurements(measurements) {
  return JSON.stringify(
    {
      format: 'mesh-measurements',
      version: 1,
      measurements: measurements.map((m) => ({ id: m.id, a: m.a, b: m.b })),
    },
    null,
    2
  );
}

export function deserializeMeasurements(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (data.format !== 'mesh-measurements')
    throw new Error('无法识别的测量记录格式');
  return data.measurements.map((m) => ({
    id: nextMeasurementId++,
    a: { ...m.a },
    b: { ...m.b },
  }));
}
