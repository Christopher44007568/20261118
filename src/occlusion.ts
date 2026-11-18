import { rayTriangle, vec3, type Vec3 } from "./math";
import type { PreparedMesh } from "./mesh";

export interface SceneHit {
  point: Vec3;
  distance: number;
  meshName: string;
  triangleIndex: number;
  normal: Vec3;
}

export interface IntersectionOptions {
  minDistance?: number;
  maxDistance?: number;
}

export function intersectMeshes(
  origin: Vec3,
  direction: Vec3,
  meshes: PreparedMesh[],
  options: IntersectionOptions = {},
): SceneHit | null {
  const minDistance = options.minDistance ?? 0;
  const maxDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
  let nearest: SceneHit | null = null;
  for (const mesh of meshes) {
    mesh.faces.forEach((face, triangleIndex) => {
      const a = mesh.positions[face[0]];
      const b = mesh.positions[face[1]];
      const c = mesh.positions[face[2]];
      if (!a || !b || !c) return;
      const distance = rayTriangle(origin, direction, a, b, c);
      if (distance === null || distance < minDistance || distance >= maxDistance) return;
      if (nearest && distance >= nearest.distance) return;
      nearest = {
        point: vec3.addScaled(origin, direction, distance),
        distance,
        meshName: mesh.source.name,
        triangleIndex,
        normal: mesh.validation.faces[triangleIndex]?.normal ?? [0, 1, 0],
      };
    });
  }
  return nearest;
}

export function isOccludedFromLight(
  point: Vec3,
  surfaceNormal: Vec3,
  lightPosition: Vec3,
  casters: PreparedMesh[],
): boolean {
  const toLight = vec3.sub(lightPosition, point);
  const distance = vec3.length(toLight);
  if (distance < 1e-5) return false;
  const direction = vec3.scale(toLight, 1 / distance);
  const normalOffset = vec3.dot(surfaceNormal, direction) >= 0 ? 2e-4 : -2e-4;
  const origin = vec3.addScaled(
    point,
    direction,
    5e-4,
  );
  const biasedOrigin = vec3.addScaled(origin, surfaceNormal, normalOffset);
  const maxDistance = vec3.length(vec3.sub(lightPosition, biasedOrigin)) - 1e-4;
  if (maxDistance <= 0) return false;

  for (const mesh of casters) {
    for (const face of mesh.faces) {
      const a = mesh.positions[face[0]];
      const b = mesh.positions[face[1]];
      const c = mesh.positions[face[2]];
      if (!a || !b || !c) continue;
      const hit = rayTriangle(biasedOrigin, direction, a, b, c);
      if (hit !== null && hit > 1e-4 && hit < maxDistance) return true;
    }
  }
  return false;
}

export function pointInsideMesh(point: Vec3, mesh: PreparedMesh): boolean {
  const direction = vec3.normalize([0.613, 0.421, 0.669]);
  let crossings = 0;
  for (const face of mesh.faces) {
    const a = mesh.positions[face[0]];
    const b = mesh.positions[face[1]];
    const c = mesh.positions[face[2]];
    if (!a || !b || !c) continue;
    const distance = rayTriangle(point, direction, a, b, c);
    if (distance !== null && distance > 1e-5) crossings += 1;
  }
  return crossings % 2 === 1;
}

