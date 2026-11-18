import {
  cameraBasis,
  rayThroughPixel,
  vec3,
  type Vec3,
} from "./math";
import { intersectMeshes, isOccludedFromLight } from "./occlusion";
import type { DemoScene } from "./scenes";
import type { CameraView } from "./renderer";

export interface ShadowVerification {
  samples: number;
  surfaceHits: number;
  matches: number;
  mismatches: number;
  mismatchRate: number;
  cpuShadowed: number;
  gpuShadowed: number;
  maskWidth: number;
  maskHeight: number;
  mismatchSamples: Array<{
    pixelX: number;
    pixelY: number;
    cpu: boolean;
    gpu: boolean;
    mesh: string;
    point: Vec3;
  }>;
}

export function verifyShadowMask(
  scene: DemoScene,
  camera: CameraView,
  mask: { width: number; height: number; pixels: Uint8Array },
  columns = 64,
  rows = 36,
): ShadowVerification {
  const basis = cameraBasis(camera.position, camera.target, [0, 1, 0], camera.fovY);
  const receivers = scene.receivers;
  let samples = 0;
  let surfaceHits = 0;
  let matches = 0;
  let mismatches = 0;
  let cpuShadowed = 0;
  let gpuShadowed = 0;
  const mismatchSamples: ShadowVerification["mismatchSamples"] = [];

  for (let row = 0; row < rows; row += 1) {
    const pixelY = Math.min(
      mask.height - 1,
      Math.max(0, Math.floor(((row + 0.5) * mask.height) / rows)),
    );
    for (let column = 0; column < columns; column += 1) {
      samples += 1;
      const pixelX = Math.min(
        mask.width - 1,
        Math.max(0, Math.floor(((column + 0.5) * mask.width) / columns)),
      );
      const direction = rayThroughPixel(
        basis,
        pixelX,
        pixelY,
        mask.width,
        mask.height,
      );
      const forwardComponent = Math.max(vec3.dot(direction, basis.forward), 1e-4);
      const hit = intersectMeshes(camera.position, direction, receivers, {
        minDistance: camera.near / forwardComponent,
        maxDistance: camera.far / forwardComponent,
      });
      if (!hit) continue;
      surfaceHits += 1;
      const cpu = isOccludedFromLight(
        hit.point,
        hit.normal,
        scene.lightPosition,
        scene.casters,
      );
      const flippedY = mask.height - 1 - pixelY;
      const gpu = mask.pixels[(flippedY * mask.width + pixelX) * 4]! > 127;
      if (cpu) cpuShadowed += 1;
      if (gpu) gpuShadowed += 1;
      if (cpu === gpu) matches += 1;
      else {
        mismatches += 1;
        if (mismatchSamples.length < 24) {
          mismatchSamples.push({
            pixelX,
            pixelY,
            cpu,
            gpu,
            mesh: hit.meshName,
            point: hit.point,
          });
        }
      }
    }
  }

  return {
    samples,
    surfaceHits,
    matches,
    mismatches,
    mismatchRate: surfaceHits === 0 ? 0 : mismatches / surfaceHits,
    cpuShadowed,
    gpuShadowed,
    maskWidth: mask.width,
    maskHeight: mask.height,
    mismatchSamples,
  };
}

export function pointInsideShadowVolume(point: Vec3, triangles: Vec3[][]): boolean {
  const direction = vec3.normalize([0.577350269, 0.577350269, 0.577350269]);
  let crossings = 0;
  for (const triangle of triangles) {
    const a = triangle[0]!;
    const b = triangle[1]!;
    const c = triangle[2]!;
    const edge1 = vec3.sub(b, a);
    const edge2 = vec3.sub(c, a);
    const p = vec3.cross(direction, edge2);
    const determinant = vec3.dot(edge1, p);
    if (Math.abs(determinant) < 1e-8) continue;
    const inverse = 1 / determinant;
    const t = vec3.sub(point, a);
    const u = vec3.dot(t, p) * inverse;
    if (u < 0 || u > 1) continue;
    const q = vec3.cross(t, edge1);
    const v = vec3.dot(direction, q) * inverse;
    if (v < 0 || u + v > 1) continue;
    if (vec3.dot(edge2, q) * inverse > 1e-5) crossings += 1;
  }
  return crossings % 2 === 1;
}
