import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createScene, refreshScene, countGeometry, VIEW } from "../src/scene.js";
import { runDiagnostics } from "../src/diagnostics.js";
import { evaluate, directionalCurvature } from "../src/evaluate.js";
import { PATCHES } from "../src/bspline-surface.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "exports"), { recursive: true });

const scene = createScene();
const initialGeo = countGeometry(scene.meshes);

// One representative curvature sample per patch (its parametric midpoint).
const targets = scene.surface.patches.map((patch) => {
  const ev = evaluate(patch, 0.5, 0.5);
  return {
    u: patch.c,
    v: patch.r,
    curvatureU: directionalCurvature(ev, "u"),
    curvatureV: directionalCurvature(ev, "v")
  };
});

const baseDiagnostics = runDiagnostics(scene.surface, scene.tessellator, scene.meshes);

// Simulate dragging a B-spline control point upward; only its support cells
// rebuild rather than the whole surface.
const snapshot = scene.surface.patches.map((p) => p.grid);
const movedNode = [4, 5];
const rebuiltIndices = scene.surface.moveNode(
  movedNode[0], movedNode[1],
  scene.surface.nodes[movedNode[1]][movedNode[0]][2] + 0.9);
let rebuiltGrids = 0;
scene.surface.patches.forEach((p, k) => {
  if (p.grid !== snapshot[k]) rebuiltGrids++;
});
refreshScene(scene, new Set(rebuiltIndices));
const localGeo = countGeometry(scene.meshes);
const localDiagnostics = runDiagnostics(scene.surface, scene.tessellator, scene.meshes);

const report = {
  resolution: { width: VIEW.width, height: VIEW.height },
  patchCount: PATCHES * PATCHES,
  vertices: localGeo.vertices,
  triangles: localGeo.triangles,
  columnSegments: scene.tessellator.colSegments,
  rowSegments: scene.tessellator.rowSegments,
  initialGeometry: initialGeo,
  targets,
  lastUpdate: {
    movedNode,
    dirtyPatches: rebuiltIndices.length,
    rebuiltPatches: rebuiltGrids,
    rebuiltIndices,
    local: true
  },
  diagnostics: localDiagnostics,
  initialDiagnostics: baseDiagnostics
};

writeFileSync(join(root, "exports", "diagnostics.json"),
  JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
