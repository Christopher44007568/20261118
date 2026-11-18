import { triangulatePolygon, type Triangle, type TriangleMesh } from "./mesh";
import { vec3, type Vec3 } from "./math";

function translated(positions: Vec3[], offset: Vec3): Vec3[] {
  return positions.map((position) => vec3.add(position, offset));
}

export function createCube(center: Vec3, halfSize: number, name = "cube"): TriangleMesh {
  const h = halfSize;
  const base: Vec3[] = [
    [-h, -h, -h],
    [h, -h, -h],
    [h, h, -h],
    [-h, h, -h],
    [-h, -h, h],
    [h, -h, h],
    [h, h, h],
    [-h, h, h],
  ];
  const faces: Triangle[] = [
    [4, 5, 6], [4, 6, 7],
    [1, 0, 3], [1, 3, 2],
    [5, 1, 2], [5, 2, 6],
    [0, 4, 7], [0, 7, 3],
    [3, 7, 6], [3, 6, 2],
    [0, 1, 5], [0, 5, 4],
  ];
  return { name, positions: translated(base, center), faces, color: [0.24, 0.43, 0.72] };
}

export function createConcavePrism(
  center: Vec3,
  height: number,
  scale = 1,
  name = "concave-l",
): TriangleMesh {
  const footprint: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 0],
    [0, 0],
    [0, 1],
    [-1, 1],
  ];
  const positions: Vec3[] = [];
  for (const [x, z] of footprint) positions.push([x * scale, 0, z * scale]);
  for (const [x, z] of footprint) positions.push([x * scale, height, z * scale]);
  const faces: Triangle[] = [];
  const bottom2D = positions.slice(0, footprint.length);
  const top2D = positions.slice(footprint.length);
  for (const triangle of triangulatePolygon(bottom2D)) faces.push(triangle);

  const topOrder = footprint.map((_, index) => index).reverse();
  const topPolygon = topOrder.map((index) => top2D[index]!);
  for (const triangle of triangulatePolygon(topPolygon)) {
    faces.push([
      topOrder[triangle[0]]! + footprint.length,
      topOrder[triangle[1]]! + footprint.length,
      topOrder[triangle[2]]! + footprint.length,
    ]);
  }

  const count = footprint.length;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const bottomCurrent = index;
    const bottomNext = next;
    const topCurrent = index + count;
    const topNext = next + count;
    faces.push([bottomNext, bottomCurrent, topCurrent]);
    faces.push([bottomNext, topCurrent, topNext]);
  }
  return {
    name,
    positions: translated(positions, center),
    faces,
    color: [0.68, 0.31, 0.16],
  };
}

export function createGround(size = 24): TriangleMesh {
  const positions: Vec3[] = [
    [-size, 0, -size],
    [size, 0, size],
    [size, 0, -size],
    [-size, 0, size],
  ];
  return {
    name: "ground",
    positions,
    faces: [
      [0, 1, 2],
      [0, 3, 1],
    ],
    color: [0.24, 0.27, 0.33],
  };
}

export function createOpenBox(center: Vec3, halfSize: number): TriangleMesh {
  const cube = createCube(center, halfSize, "open-box");
  const missingTop = cube.faces.filter(
    (_, index) => index !== 8 && index !== 9,
  );
  return { ...cube, faces: missingTop, color: [0.54, 0.2, 0.25] };
}

export function createNonManifoldFan(center: Vec3): TriangleMesh {
  const positions: Vec3[] = [
    [-0.8, 0, 0],
    [0.8, 0, 0],
    [-0.1, 1.15, -0.45],
    [0.35, 1.3, 0.3],
    [0.1, -0.6, 0.7],
  ].map((point) => vec3.add(point as Vec3, center));
  return {
    name: "non-manifold",
    positions,
    faces: [
      [0, 1, 2],
      [1, 0, 3],
      [0, 1, 4],
    ],
    color: [0.65, 0.24, 0.27],
  };
}

export function createCubePair(): TriangleMesh[] {
  return [
    createCube([-1.15, 1.15, 0.15], 0.9, "cube-a"),
    createCube([1.05, 1.25, -0.15], 0.95, "cube-b"),
  ];
}
