const CORNERS = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

const QUADS = [
  [0, 3, 2, 1],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [3, 7, 6, 2],
  [0, 4, 7, 3],
  [1, 2, 6, 5],
];

function rotatePoint(point, rotation) {
  const [x, y, z] = point;
  const [rx, ry, rz] = rotation;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

  const y1 = y * cx - z * sx;
  const z1 = y * sx + z * cx;
  const x2 = x * cy + z1 * sy;
  const z2 = -x * sy + z1 * cy;
  return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
}

function faceTriangles(face, flipDiagonal) {
  const [a, b, c, d] = face;
  return flipDiagonal
    ? [a, b, d, b, c, d]
    : [a, b, c, a, c, d];
}

/**
 * Build an indexed, outward-wound box. Flipping selected face diagonals lets
 * the coplanar test contain crossing triangles without introducing holes.
 */
export function createBox({
  center = [0, 0, 0],
  size = [1, 1, 1],
  rotation = [0, 0, 0],
  flipDiagonals = [],
} = {}) {
  const positions = new Float32Array(CORNERS.length * 3);
  CORNERS.forEach((corner, index) => {
    const local = [
      corner[0] * size[0] * 0.5,
      corner[1] * size[1] * 0.5,
      corner[2] * size[2] * 0.5,
    ];
    const rotated = rotatePoint(local, rotation);
    positions.set(
      [
        rotated[0] + center[0],
        rotated[1] + center[1],
        rotated[2] + center[2],
      ],
      index * 3,
    );
  });

  const triangles = [];
  QUADS.forEach((quad, faceIndex) => {
    triangles.push(...faceTriangles(quad, flipDiagonals.includes(faceIndex)));
  });

  return {
    positions,
    indices: new Uint32Array(triangles),
  };
}

export function meshBounds(mesh) {
  if (!mesh || mesh.positions.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.positions[i + axis]);
      max[axis] = Math.max(max[axis], mesh.positions[i + axis]);
    }
  }
  return { min, max };
}
