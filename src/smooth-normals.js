import { v3 } from "./math.js";

// Average analytic normals at shared surface points. Each patch samples its
// own grid, but coincident boundary points carry identical world coordinates;
// merging their normals removes the C1-only shading crease across seams so
// the lit surface looks G2-smooth while geometry stays exactly watertight.
export function smoothNormalsAcrossPatches(meshes) {
  const accum = new Map();
  const keyOf = (p) => `${p[0].toFixed(6)}|${p[1].toFixed(6)}|${p[2].toFixed(6)}`;
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i++) {
      const key = keyOf(mesh.positions[i]);
      let entry = accum.get(key);
      if (!entry) {
        entry = [0, 0, 0];
        accum.set(key, entry);
      }
      const n = mesh.normals[i];
      entry[0] += n[0];
      entry[1] += n[1];
      entry[2] += n[2];
    }
  }
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i++) {
      const entry = accum.get(keyOf(mesh.positions[i]));
      mesh.normals[i] = v3.norm(entry);
    }
  }
  return meshes;
}
