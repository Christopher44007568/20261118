import { triangleCentroid, triangleNormal, vec3, type Vec3 } from "./math";

export type Triangle = [number, number, number];

export interface TriangleMesh {
  name: string;
  positions: Vec3[];
  faces: Triangle[];
  color?: Vec3;
}

export interface FaceData {
  indices: Triangle;
  normal: Vec3;
  centroid: Vec3;
}

export interface EdgeUse {
  face: number;
  from: number;
  to: number;
}

export interface EdgeData {
  a: number;
  b: number;
  uses: EdgeUse[];
}

export interface EdgeViolation {
  kind: "open" | "non-manifold" | "winding" | "degenerate";
  point: Vec3;
  edge?: [number, number];
  faceIndices: number[];
  faceCount: number;
}

export interface MeshValidation {
  closed: boolean;
  violations: EdgeViolation[];
  edges: EdgeData[];
  faces: FaceData[];
}

export interface PreparedMesh {
  source: TriangleMesh;
  positions: Vec3[];
  faces: Triangle[];
  validation: MeshValidation;
}

const WELD_PRECISION = 1e5;

function positionKey(position: Vec3): string {
  return `${Math.round(position[0] * WELD_PRECISION)},${Math.round(
    position[1] * WELD_PRECISION,
  )},${Math.round(position[2] * WELD_PRECISION)}`;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function prepareMesh(source: TriangleMesh): PreparedMesh {
  const positionMap = new Map<string, number>();
  const positions: Vec3[] = [];
  const remap = (index: number): number => {
    const original = source.positions[index];
    if (!original) throw new Error(`Face index ${index} is outside mesh ${source.name}`);
    const key = positionKey(original);
    const existing = positionMap.get(key);
    if (existing !== undefined) return existing;
    const next = positions.length;
    positions.push([...original]);
    positionMap.set(key, next);
    return next;
  };

  const faces = source.faces.map(
    (face) => [remap(face[0]), remap(face[1]), remap(face[2])] as Triangle,
  );
  const edgeMap = new Map<string, EdgeData>();
  const violations: EdgeViolation[] = [];
  const faceData: FaceData[] = [];

  faces.forEach((face, faceIndex) => {
    const a = positions[face[0]];
    const b = positions[face[1]];
    const c = positions[face[2]];
    if (!a || !b || !c) return;
    const normal = triangleNormal(a, b, c);
    const centroid = triangleCentroid(a, b, c);
    if (vec3.length(normal) < 0.5) {
      violations.push({
        kind: "degenerate",
        point: centroid,
        faceIndices: [faceIndex],
        faceCount: 1,
      });
    }
    faceData.push({ indices: face, normal, centroid });
    const oriented = [
      [face[0], face[1]],
      [face[1], face[2]],
      [face[2], face[0]],
    ] as const;
    for (const [from, to] of oriented) {
      const key = edgeKey(from, to);
      let edge = edgeMap.get(key);
      if (!edge) {
        edge = { a: Math.min(from, to), b: Math.max(from, to), uses: [] };
        edgeMap.set(key, edge);
      }
      edge.uses.push({ face: faceIndex, from, to });
    }
  });

  const edges = [...edgeMap.values()];
  for (const edge of edges) {
    if (edge.uses.length === 1) {
      const a = positions[edge.a];
      const b = positions[edge.b];
      if (a && b) {
        violations.push({
          kind: "open",
          edge: [edge.a, edge.b],
          point: vec3.lerp(a, b, 0.5),
          faceIndices: edge.uses.map((use) => use.face),
          faceCount: 1,
        });
      }
      continue;
    }
    if (edge.uses.length > 2) {
      const a = positions[edge.a];
      const b = positions[edge.b];
      if (a && b) {
        violations.push({
          kind: "non-manifold",
          edge: [edge.a, edge.b],
          point: vec3.lerp(a, b, 0.5),
          faceIndices: edge.uses.map((use) => use.face),
          faceCount: edge.uses.length,
        });
      }
      continue;
    }
    const first = edge.uses[0];
    const second = edge.uses[1];
    if (first && second && first.from === second.from && first.to === second.to) {
      violations.push({
        kind: "winding",
        edge: [edge.a, edge.b],
        point: vec3.lerp(positions[edge.a]!, positions[edge.b]!, 0.5),
        faceIndices: [first.face, second.face],
        faceCount: 2,
      });
    }
  }

  return {
    source,
    positions,
    faces,
    validation: {
      closed: violations.length === 0,
      violations,
      edges,
      faces: faceData,
    },
  };
}

export function triangulatePolygon(points: Vec3[]): Triangle[] {
  if (points.length < 3) return [];
  if (points.length === 3) return [[0, 1, 2]];

  let normal: Vec3 = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    normal = vec3.add(normal, [
      (current[1] - next[1]) * (current[2] + next[2]),
      (current[2] - next[2]) * (current[0] + next[0]),
      (current[0] - next[0]) * (current[1] + next[1]),
    ]);
  }
  normal = vec3.normalize(normal);
  if (vec3.length(normal) < 0.5) {
    normal = [0, 1, 0];
  }
  const helper: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const axisX = vec3.normalize(vec3.cross(helper, normal));
  const axisY = vec3.cross(normal, axisX);
  const projected = points.map((point): [number, number] => [
    vec3.dot(point, axisX),
    vec3.dot(point, axisY),
  ]);
  let area = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index]!;
    const next = projected[(index + 1) % projected.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  const orientation = Math.sign(area) || 1;
  const remaining = points.map((_, index) => index);
  const result: Triangle[] = [];
  let guard = remaining.length * remaining.length;

  const cross2 = (a: [number, number], b: [number, number], c: [number, number]): number =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const pointInTriangle = (
    point: [number, number],
    a: [number, number],
    b: [number, number],
    c: [number, number],
  ): boolean => {
    const d1 = cross2(point, a, b) * orientation;
    const d2 = cross2(point, b, c) * orientation;
    const d3 = cross2(point, c, a) * orientation;
    return d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9;
  };

  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previous = remaining[(cursor + remaining.length - 1) % remaining.length]!;
      const current = remaining[cursor]!;
      const next = remaining[(cursor + 1) % remaining.length]!;
      const a = projected[previous]!;
      const b = projected[current]!;
      const c = projected[next]!;
      if (cross2(a, b, c) * orientation <= 1e-9) continue;
      let containsPoint = false;
      for (const candidate of remaining) {
        if (candidate === previous || candidate === current || candidate === next) continue;
        if (pointInTriangle(projected[candidate]!, a, b, c)) {
          containsPoint = true;
          break;
        }
      }
      if (containsPoint) continue;
      result.push([previous, current, next]);
      remaining.splice(cursor, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }

  if (remaining.length === 3) {
    result.push([remaining[0]!, remaining[1]!, remaining[2]!]);
  } else {
    for (let index = 1; index < remaining.length - 1; index += 1) {
      result.push([remaining[0]!, remaining[index]!, remaining[index + 1]!]);
    }
  }
  return result;
}
