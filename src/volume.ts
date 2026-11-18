import { triangleCentroid, triangleNormal, vec3, type Vec3 } from "./math";
import {
  triangulatePolygon,
  type FaceData,
  type PreparedMesh,
} from "./mesh";

export interface SilhouetteEdge {
  nearA: Vec3;
  nearB: Vec3;
  farA: Vec3;
  farB: Vec3;
}

export interface ShadowVolume {
  triangles: Vec3[][];
  silhouetteEdges: SilhouetteEdge[];
  silhouetteLoops: Vec3[][];
  frontTriangleCount: number;
  farTriangleCount: number;
  extrusionDistance: number;
}

export type VolumeBuildResult =
  | { ok: true; volume: ShadowVolume }
  | { ok: false; reason: string };

interface OrientedSegment {
  from: number;
  to: number;
}

function faceFacingLight(face: FaceData, lightPosition: Vec3): boolean {
  return vec3.dot(face.normal, vec3.sub(lightPosition, face.centroid)) > 1e-5;
}

function silhouetteSegments(
  mesh: PreparedMesh,
  lightPosition: Vec3,
): { segments: OrientedSegment[]; facingFaces: FaceData[] } {
  const facing = mesh.validation.faces.map((face) => faceFacingLight(face, lightPosition));
  const segments: OrientedSegment[] = [];
  const facingFaces = mesh.validation.faces.filter((_, index) => facing[index]);
  for (const edge of mesh.validation.edges) {
    if (edge.uses.length !== 2) continue;
    const [first, second] = edge.uses as [typeof edge.uses[0], typeof edge.uses[1]];
    if (facing[first.face] === facing[second.face]) continue;
    const front = facing[first.face] ? first : second;
    segments.push({ from: front.from, to: front.to });
  }
  return { segments, facingFaces };
}

function farPoint(lightPosition: Vec3, vertex: Vec3, distance: number): Vec3 {
  const direction = vec3.normalize(vec3.sub(vertex, lightPosition));
  const safeDirection = vec3.lengthSq(direction) > 0.5 ? direction : ([0, 1, 0] as Vec3);
  return vec3.addScaled(lightPosition, safeDirection, distance);
}

function buildLoops(segments: OrientedSegment[]): OrientedSegment[][] {
  const outgoing = new Map<number, number[]>();
  segments.forEach((segment, index) => {
    const list = outgoing.get(segment.from) ?? [];
    list.push(index);
    outgoing.set(segment.from, list);
  });
  const visited = new Set<number>();
  const loops: OrientedSegment[][] = [];

  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    if (visited.has(startIndex)) continue;
    const loop: OrientedSegment[] = [];
    let currentIndex = startIndex;
    let guard = segments.length + 1;
    while (guard > 0 && !visited.has(currentIndex)) {
      guard -= 1;
      const segment = segments[currentIndex]!;
      visited.add(currentIndex);
      loop.push(segment);
      const candidates = outgoing.get(segment.to) ?? [];
      const next = candidates.find((candidate) => !visited.has(candidate));
      if (next === undefined) break;
      currentIndex = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function addEdge(map: Map<string, number>, a: number, b: number): void {
  const key = `${a}:${b}`;
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function countNonWatertightEdges(triangles: Vec3[][]): number {
  return inspectTriangleTopology(triangles).openEdges;
}

export function countInconsistentWindingEdges(triangles: Vec3[][]): number {
  return inspectTriangleTopology(triangles).inconsistentEdges;
}

export function inspectTriangleTopology(triangles: Vec3[][]): {
  openEdges: number;
  inconsistentEdges: number;
} {
  const vertexIds = new Map<string, number>();
  const positions: Vec3[] = [];
  const idFor = (point: Vec3): number => {
    const key = point.map((value) => Math.round(value * 1e5)).join(",");
    const existing = vertexIds.get(key);
    if (existing !== undefined) return existing;
    const id = positions.length;
    positions.push(point);
    vertexIds.set(key, id);
    return id;
  };
  const directedEdges = new Map<string, number>();
  for (const triangle of triangles) {
    if (triangle.length !== 3) continue;
    const a = idFor(triangle[0]!);
    const b = idFor(triangle[1]!);
    const c = idFor(triangle[2]!);
    addEdge(directedEdges, a, b);
    addEdge(directedEdges, b, c);
    addEdge(directedEdges, c, a);
  }
  let openEdges = 0;
  let inconsistentEdges = 0;
  const checked = new Set<string>();
  for (const key of directedEdges.keys()) {
    if (checked.has(key)) continue;
    const [left, right] = key.split(":").map(Number) as [number, number];
    const reverse = `${right}:${left}`;
    checked.add(key);
    checked.add(reverse);
    const forwardUses = directedEdges.get(key) ?? 0;
    const reverseUses = directedEdges.get(reverse) ?? 0;
    if (forwardUses + reverseUses !== 2) {
      openEdges += 1;
    } else if (forwardUses !== 1 || reverseUses !== 1) {
      inconsistentEdges += 1;
    }
  }
  return { openEdges, inconsistentEdges };
}

export function buildShadowVolume(
  mesh: PreparedMesh,
  lightPosition: Vec3,
  extrusionDistance = 100,
): VolumeBuildResult {
  if (!mesh.validation.closed) {
    return { ok: false, reason: `${mesh.source.name}: 网格未通过封闭流形校验` };
  }
  const { segments, facingFaces } = silhouetteSegments(mesh, lightPosition);
  if (facingFaces.length === 0) {
    return { ok: false, reason: `${mesh.source.name}: 点光源位于实体内部，无有效光照面` };
  }
  if (segments.length === 0) {
    return { ok: false, reason: `${mesh.source.name}: 未找到轮廓边` };
  }

  const triangles: Vec3[][] = [];
  const silhouetteEdges: SilhouetteEdge[] = [];
  const silhouetteLoops: Vec3[][] = [];

  for (const face of facingFaces) {
    const a = mesh.positions[face.indices[0]]!;
    const b = mesh.positions[face.indices[1]]!;
    const c = mesh.positions[face.indices[2]]!;
    triangles.push([a, b, c]);
  }
  const frontTriangleCount = triangles.length;

  for (const segment of segments) {
    const nearA = mesh.positions[segment.from]!;
    const nearB = mesh.positions[segment.to]!;
    const farA = farPoint(lightPosition, nearA, extrusionDistance);
    const farB = farPoint(lightPosition, nearB, extrusionDistance);
    silhouetteEdges.push({ nearA, nearB, farA, farB });
    triangles.push([nearB, nearA, farA]);
    triangles.push([nearB, farA, farB]);
  }

  for (const loop of buildLoops(segments)) {
    const nearLoop: Vec3[] = [];
    loop.forEach((segment) => nearLoop.push(mesh.positions[segment.from]!));
    silhouetteLoops.push(nearLoop);
    const farLoop = nearLoop
      .map((point) => farPoint(lightPosition, point, extrusionDistance))
      .reverse();
    for (const indices of triangulatePolygon(farLoop)) {
      const a = farLoop[indices[0]]!;
      const b = farLoop[indices[1]]!;
      const c = farLoop[indices[2]]!;
      const center = triangleCentroid(a, b, c);
      if (vec3.dot(triangleNormal(a, b, c), vec3.sub(center, lightPosition)) >= 0) {
        triangles.push([a, b, c]);
      } else {
        triangles.push([a, c, b]);
      }
    }
  }

  return {
    ok: true,
    volume: {
      triangles,
      silhouetteEdges,
      silhouetteLoops,
      frontTriangleCount,
      farTriangleCount: triangles.length - frontTriangleCount - silhouetteEdges.length * 2,
      extrusionDistance,
    },
  };
}

