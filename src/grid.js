export const DEFAULT_EXTENT = 1.15;

export function sampleGrid(field, options = {}) {
  const resolution = clampInt(options.resolution ?? 56, 16, 96);
  const extent = options.extent ?? DEFAULT_EXTENT;
  const iso = options.iso ?? 0;
  const sampleCount = resolution;
  const cellCount = resolution - 1;
  const step = (extent * 2) / cellCount;
  const values = new Float32Array(sampleCount ** 3);
  let cursor = 0;

  for (let k = 0; k < sampleCount; k += 1) {
    const z = -extent + k * step;
    for (let j = 0; j < sampleCount; j += 1) {
      const y = -extent + j * step;
      for (let i = 0; i < sampleCount; i += 1) {
        values[cursor] = field.evaluate(-extent + i * step, y, z);
        cursor += 1;
      }
    }
  }

  return {
    field,
    values,
    iso,
    extent,
    origin: -extent,
    resolution: sampleCount,
    cellCount,
    step,
    sampleIndex(i, j, k) {
      return i + sampleCount * (j + sampleCount * k);
    },
    cellIndex(i, j, k) {
      return i + cellCount * (j + cellCount * k);
    },
    worldCoordinate(i, j, k) {
      return [
        -extent + i * step,
        -extent + j * step,
        -extent + k * step,
      ];
    },
  };
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value))));
}

export const CUBE_CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

export const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export function readCell(grid, i, j, k, target = new Float32Array(8)) {
  for (let corner = 0; corner < 8; corner += 1) {
    const [dx, dy, dz] = CUBE_CORNERS[corner];
    target[corner] = grid.values[grid.sampleIndex(i + dx, j + dy, k + dz)];
  }
  return target;
}

export function cellIsActive(cell, iso) {
  let inside = 0;
  for (let i = 0; i < 8; i += 1) {
    if (cell[i] > iso) inside += 1;
  }
  return inside > 0 && inside < 8;
}
