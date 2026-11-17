// Verification driver: cube + open mixed tri/quad plane, two subdivision rounds.
// Checks: boundary vertices stay put, face-count rule, no duplicate edges,
// no holes (every interior edge shared by exactly 2 faces). Exports OBJ files.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, meshToObj, collectEdges, faceStats } from './mesh.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'artifacts', 'out');
mkdirSync(outDir, { recursive: true });

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function buildCube(engine) {
  engine.reset();
  const c = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
             [-1,-1, 1],[1,-1, 1],[1,1, 1],[-1,1, 1]];
  for (const [x, y, z] of c) engine.addVertex(x, y, z);
  engine.addFace([0, 3, 2, 1]); // bottom
  engine.addFace([4, 5, 6, 7]); // top
  engine.addFace([0, 1, 5, 4]); // front
  engine.addFace([1, 2, 6, 5]); // right
  engine.addFace([2, 3, 7, 6]); // back
  engine.addFace([3, 0, 4, 7]); // left
}

// Open 3x3 plane (z=0), one quad cell split into two triangles -> mixed mesh.
function buildMixedPlane(engine) {
  engine.reset();
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++)
      engine.addVertex(x, y, 0);
  // idx = y*3+x; cells: (0,0) split into triangles, others quads
  engine.addFace([0, 1, 4]);       // triangle
  engine.addFace([0, 4, 3]);       // triangle
  engine.addFace([1, 2, 5, 4]);    // quad
  engine.addFace([3, 4, 6]);       // triangle (second split cell)
  engine.addFace([4, 7, 6]);       // triangle
  engine.addFace([4, 5, 8, 7]);    // quad
}

function boundaryVertexIds(mesh) {
  const edges = collectEdges(mesh);
  const ids = new Set();
  for (const [key, faces] of edges) {
    if (faces.length === 1) {
      const [a, b] = key.split(',').map(Number);
      ids.add(a); ids.add(b);
    }
  }
  return ids;
}

function boundaryVertsUnchanged(before, after) {
  // original vertices keep their indices after one subdivision step
  const eps = 1e-5;
  let worst = 0;
  for (const v of boundaryVertexIds(before)) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(before.positions[3 * v + c] - after.positions[3 * v + c]);
      worst = Math.max(worst, d);
    }
  }
  return { ok: worst < eps, worst };
}

function noDuplicateEdges(mesh) {
  const seen = new Set();
  for (const face of mesh.faces) {
    const n = face.length;
    for (let i = 0; i < n; i++) {
      const a = face[i], b = face[(i + 1) % n];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) {
        // an edge seen more than twice total, or a repeated directed pair, is a defect
      }
      seen.add(key);
    }
  }
  // duplicate edge = same unordered pair used by more than 2 half-edges
  const edges = collectEdges(mesh);
  for (const [key, faces] of edges) {
    if (faces.length > 2) return { ok: false, key, count: faces.length };
  }
  return { ok: true, edgeCount: edges.size };
}

function noHoles(mesh, expectedBoundaryEdges) {
  const edges = collectEdges(mesh);
  let boundary = 0;
  for (const [, faces] of edges) {
    if (faces.length === 1) boundary++;
  }
  return { ok: boundary === expectedBoundaryEdges, boundary };
}

function runCase(name, builder, expected, engine) {
  console.log(`\n=== ${name} ===`);
  builder(engine);
  const before = engine.readMesh();
  console.log(`  level 0: ${before.positions.length / 3} verts, ${before.faces.length} faces`);
  writeFileSync(join(outDir, `${name}_level0.obj`), meshToObj(before, `${name}_level0`));

  check('level0 face count', before.faces.length === expected.f0, `got ${before.faces.length}, want ${expected.f0}`);

  // round 1
  engine.subdivide();
  const mid = engine.readMesh();
  const b1 = boundaryVertsUnchanged(before, mid);
  check('round1 boundary verts unchanged', b1.ok, `max drift ${b1.worst.toExponential(2)}`);
  check('round1 face count rule (F1 = sum of corners)', mid.faces.length === expected.f1,
        `got ${mid.faces.length}, want ${expected.f1}`);
  const d1 = noDuplicateEdges(mid);
  check('round1 no duplicate edges', d1.ok, `${d1.edgeCount} unique edges`);
  const h1 = noHoles(mid, expected.b1);
  check('round1 no holes (boundary edge count)', h1.ok, `${h1.boundary} boundary edges, want ${expected.b1}`);

  // round 2
  engine.subdivide();
  const after = engine.readMesh();
  const b2 = boundaryVertsUnchanged(mid, after);
  check('round2 boundary verts unchanged', b2.ok, `max drift ${b2.worst.toExponential(2)}`);
  check('round2 face count rule (F2 = 4 * F1)', after.faces.length === expected.f2,
        `got ${after.faces.length}, want ${expected.f2}`);
  const d2 = noDuplicateEdges(after);
  check('round2 no duplicate edges', d2.ok, `${d2.edgeCount} unique edges`);
  const h2 = noHoles(after, expected.b2);
  check('round2 no holes (boundary edge count)', h2.ok, `${h2.boundary} boundary edges, want ${expected.b2}`);
  const allQuads = after.faces.every((f) => f.length === 4);
  check('round2 all faces are quads', allQuads);

  console.log(`  level 2: ${after.positions.length / 3} verts, ${after.faces.length} faces, total area ${engine.totalArea().toFixed(6)}`);
  writeFileSync(join(outDir, `${name}_level2.obj`), meshToObj(after, `${name}_level2`));

  // per-face normal/area stats sample
  const stats = faceStats(engine, after);
  const areas = stats.map((s) => s.area);
  const minA = Math.min(...areas), maxA = Math.max(...areas);
  console.log(`  face area range: [${minA.toFixed(6)}, ${maxA.toFixed(6)}]`);
  console.log(`  sample face 0: normal=(${stats[0].normal.map((x) => x.toFixed(3)).join(', ')}), area=${stats[0].area.toFixed(6)}`);
  const badNormals = stats.filter((s) => Math.abs(Math.hypot(...s.normal) - 1) > 1e-3).length;
  check('all face normals are unit length', badNormals === 0, `${badNormals} bad`);
}

const engine = await loadEngine();

// cube: 6 quads -> 24 -> 96 faces; closed mesh, 0 boundary edges
runCase('cube', buildCube, { f0: 6, f1: 24, f2: 96, b1: 0, b2: 0 }, engine);

// mixed plane: 2 quads + 4 tris = 6 faces, 20 corners -> 20 -> 80 faces
// boundary edges: 8 on the outline -> 16 after round1 -> 32 after round2
runCase('plane_mixed', buildMixedPlane, { f0: 6, f1: 20, f2: 80, b1: 16, b2: 32 }, engine);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
