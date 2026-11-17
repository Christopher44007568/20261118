// JS wrapper around the Catmull-Clark WebAssembly core.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadEngine(wasmPath = join(here, '..', 'build', 'catmull_clark.wasm')) {
  const bytes = readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;

  function readMesh() {
    const nv = ex.cc_num_vertices();
    const nf = ex.cc_num_faces();
    const posPtr = ex.cc_positions();
    const positions = new Float32Array(ex.memory.buffer, posPtr, nv * 3).slice();
    const offPtr = ex.cc_face_offsets();
    const offsets = new Int32Array(ex.memory.buffer, offPtr, nf + 1).slice();
    const vertPtr = ex.cc_face_verts();
    const corners = new Int32Array(ex.memory.buffer, vertPtr, offsets[nf]).slice();
    const bndPtr = ex.cc_boundary_flags();
    const boundary = new Int32Array(ex.memory.buffer, bndPtr, nv).slice();
    const faces = [];
    for (let f = 0; f < nf; f++) faces.push(Array.from(corners.slice(offsets[f], offsets[f + 1])));
    return { positions, faces, boundary };
  }

  return {
    exports: ex,
    reset: () => ex.cc_reset(),
    addVertex: (x, y, z) => ex.cc_add_vertex(x, y, z),
    addFace: (verts) => {
      ex.cc_begin_face();
      for (const v of verts) ex.cc_add_face_vertex(v);
      return ex.cc_end_face();
    },
    subdivide: () => ex.cc_subdivide(),
    readMesh,
    faceNormal: (f) => {
      const ptr = ex.cc_face_normal(f);
      return Array.from(new Float32Array(ex.memory.buffer, ptr, 3));
    },
    faceArea: (f) => ex.cc_face_area(f),
    totalArea: () => ex.cc_total_area(),
  };
}

export function meshToObj(mesh, name = 'mesh') {
  const lines = [`o ${name}`];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    lines.push(`v ${p[i].toFixed(6)} ${p[i + 1].toFixed(6)} ${p[i + 2].toFixed(6)}`);
  }
  for (const face of mesh.faces) {
    lines.push('f ' + face.map((v) => v + 1).join(' '));
  }
  return lines.join('\n') + '\n';
}

// ---- geometry / topology checks -------------------------------------------

export function collectEdges(mesh) {
  const map = new Map(); // "a,b" (a<b) -> list of face ids
  mesh.faces.forEach((face, f) => {
    const n = face.length;
    for (let i = 0; i < n; i++) {
      const a = face[i];
      const b = face[(i + 1) % n];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(f);
    }
  });
  return map;
}

export function checkManifold(mesh) {
  const edges = collectEdges(mesh);
  const problems = [];
  let boundaryEdges = 0;
  for (const [key, faces] of edges) {
    if (faces.length > 2) problems.push(`non-manifold edge ${key}: ${faces.length} faces`);
    if (faces.length === 1) boundaryEdges++;
  }
  return { edgeCount: edges.size, boundaryEdges, problems };
}

export function faceStats(engine, mesh) {
  const stats = [];
  for (let f = 0; f < mesh.faces.length; f++) {
    stats.push({ face: f, normal: engine.faceNormal(f), area: engine.faceArea(f) });
  }
  return stats;
}
