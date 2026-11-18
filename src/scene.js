import { BSplineSurface } from "./bspline-surface.js";
import { createInitialNodes } from "./evaluate.js";
import { Camera } from "./camera.js";
import { Tessellator } from "./tessellate.js";
import { smoothNormalsAcrossPatches } from "./smooth-normals.js";

export const VIEW = { width: 1400, height: 900 };
export const EYE = [4.6, -10.8, 11.0];

export function createScene({ tolerancePx = 1.0, width = VIEW.width, height = VIEW.height } = {}) {
  const surface = new BSplineSurface(createInitialNodes(7));
  const camera = new Camera({ width, height, eye: EYE, center: [0, 0, -0.1] });
  const tessellator = new Tessellator(camera, tolerancePx);
  tessellator.computeLevels(surface);
  const meshes = smoothNormalsAcrossPatches(tessellator.buildAll(surface));
  return { surface, camera, tessellator, meshes, grid: surface.grid };
}

export function refreshScene(scene, dirtyPatchSet = null) {
  scene.tessellator.computeLevels(scene.surface, dirtyPatchSet);
  scene.meshes = smoothNormalsAcrossPatches(scene.tessellator.buildAll(scene.surface));
  return scene;
}

export function countGeometry(meshes) {
  let vertices = 0;
  let triangles = 0;
  for (const m of meshes) {
    vertices += m.positions.length;
    triangles += m.triangles.length;
  }
  return { vertices, triangles };
}
