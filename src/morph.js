export const SAFE_WEIGHT_MIN = 0;
export const SAFE_WEIGHT_MAX = 1;

export const MORPH_TARGETS = Object.freeze([
  {
    id: "smile",
    label: "微笑",
    shortLabel: "SMILE",
    accent: "#ffb067",
    description: "嘴角上扬、苹果肌隆起",
  },
  {
    id: "blink",
    label: "眨眼",
    shortLabel: "BLINK",
    accent: "#6ed8ff",
    description: "上下眼睑向眼裂收拢",
  },
  {
    id: "brow",
    label: "眉部",
    shortLabel: "BROW",
    accent: "#c6a7ff",
    description: "眉弓抬高并向前隆起",
  },
]);

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

export function clamp(value, min = SAFE_WEIGHT_MIN, max = SAFE_WEIGHT_MAX) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function gaussian(x, y, cx, cy, sx, sy) {
  const dx = (x - cx) / sx;
  const dy = (y - cy) / sy;
  return Math.exp(-(dx * dx + dy * dy));
}

function faceRelief(x, y) {
  let z = 0;
  z += 0.09 * gaussian(x, y, 0, 0.28, 0.58, 0.30);
  z += 0.20 * gaussian(x, y, 0, -0.06, 0.12, 0.34);
  z += 0.13 * gaussian(x, y, 0, -0.29, 0.17, 0.14);
  z += 0.06 * gaussian(x, y, 0, -0.08, 0.31, 0.24);
  z -= 0.048 * gaussian(x, y, -0.35, 0.08, 0.22, 0.12);
  z -= 0.048 * gaussian(x, y, 0.35, 0.08, 0.22, 0.12);
  z += 0.038 * gaussian(x, y, -0.54, -0.20, 0.26, 0.24);
  z += 0.038 * gaussian(x, y, 0.54, -0.20, 0.26, 0.24);
  z -= 0.026 * gaussian(x, y, 0, -0.46, 0.24, 0.09);
  z += 0.016 * gaussian(x, y, 0, -0.84, 0.30, 0.20);
  return z;
}

function createBaseGeometry(segments, rings) {
  const vertexCount = 1 + segments * rings;
  const positions = new Float32Array(vertexCount * 3);
  positions[0] = 0;
  positions[1] = -0.02;
  positions[2] = 0.62 + faceRelief(0, -0.02);

  for (let ring = 1; ring <= rings; ring += 1) {
    const radial = ring / rings;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * TAU;
      const sin = Math.sin(angle);
      const jaw = 1 - 0.11 * Math.pow(Math.max(0, -sin), 1.35);
      const x = 1.02 * radial * Math.cos(angle) * jaw;
      const y = -0.02 + 1.16 * radial * sin * (sin < 0 ? 0.98 : 1);
      const dome = 0.62 * Math.cos(radial * Math.PI * 0.5);
      const edgeFade = 1 - Math.pow(radial, 8);
      const index = (1 + (ring - 1) * segments + segment) * 3;
      positions[index] = x;
      positions[index + 1] = y;
      positions[index + 2] = dome + faceRelief(x, y) * edgeFade;
    }
  }
  return { positions, vertexCount };
}

function ringVertex(segments, ring, segment) {
  return 1 + (ring - 1) * segments + (segment % segments);
}

function createTopology(segments, rings) {
  const triangles = [];
  for (let segment = 0; segment < segments; segment += 1) {
    triangles.push(0, ringVertex(segments, 1, segment), ringVertex(segments, 1, segment + 1));
  }

  for (let ring = 1; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const inner = ringVertex(segments, ring, segment);
      const innerNext = ringVertex(segments, ring, segment + 1);
      const outer = ringVertex(segments, ring + 1, segment);
      const outerNext = ringVertex(segments, ring + 1, segment + 1);
      triangles.push(inner, outer, innerNext, innerNext, outer, outerNext);
    }
  }

  const outline = [];
  for (let segment = 0; segment < segments; segment += 1) {
    outline.push(ringVertex(segments, rings, segment));
  }
  return {
    triangles: new Uint32Array(triangles),
    outline: new Uint32Array(outline),
  };
}

export function computeVertexNormals(positions, triangles, vertexCount) {
  const normals = new Float32Array(positions.length);
  for (let index = 0; index < triangles.length; index += 3) {
    const a = triangles[index] * 3;
    const b = triangles[index + 1] * 3;
    const c = triangles[index + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const offset of [a, b, c]) {
      normals[offset] += nx;
      normals[offset + 1] += ny;
      normals[offset + 2] += nz;
    }
  }

  for (let index = 0; index < vertexCount * 3; index += 3) {
    const length = Math.hypot(
      normals[index],
      normals[index + 1],
      normals[index + 2],
    );
    if (length < EPSILON) {
      normals[index] = 0;
      normals[index + 1] = 0;
      normals[index + 2] = 1;
    } else {
      normals[index] /= length;
      normals[index + 1] /= length;
      normals[index + 2] /= length;
    }
  }
  return normals;
}

export function computeFaceNormals(positions, triangles) {
  const faceNormals = new Float32Array(triangles.length);
  for (let index = 0; index < triangles.length; index += 3) {
    const a = triangles[index] * 3;
    const b = triangles[index + 1] * 3;
    const c = triangles[index + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz);
    if (length > EPSILON) {
      nx /= length;
      ny /= length;
      nz /= length;
    }
    faceNormals[index] = nx;
    faceNormals[index + 1] = ny;
    faceNormals[index + 2] = nz;
  }
  return faceNormals;
}

function buildSmileTarget(basePositions) {
  const positions = basePositions.slice();
  for (let index = 0; index < positions.length; index += 3) {
    const x = basePositions[index];
    const y = basePositions[index + 1];
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (const side of [-1, 1]) {
      const corner = gaussian(x, y, side * 0.31, -0.45, 0.23, 0.17);
      const cheek = gaussian(x, y, side * 0.51, -0.20, 0.27, 0.23);
      const lip = gaussian(x, y, side * 0.09, -0.45, 0.16, 0.105);
      dx += side * (0.082 * corner + 0.028 * cheek);
      dy += 0.158 * corner + 0.034 * cheek + 0.018 * lip;
      dz += 0.042 * corner + 0.070 * cheek - 0.016 * lip;
    }
    positions[index] += dx;
    positions[index + 1] += dy;
    positions[index + 2] += dz;
  }
  return positions;
}

function buildBlinkTarget(basePositions) {
  const positions = basePositions.slice();
  for (let index = 0; index < positions.length; index += 3) {
    const x = basePositions[index];
    const y = basePositions[index + 1];
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (const side of [-1, 1]) {
      const eyeX = side * 0.35;
      const eyeY = 0.08;
      const lid = gaussian(x, y, eyeX, eyeY, 0.205, 0.115);
      const crease = gaussian(x, y, eyeX, eyeY + 0.12, 0.24, 0.08);
      dx -= side * 0.010 * lid;
      dy += (eyeY - y) * 0.48 * lid + 0.014 * crease;
      dz -= 0.052 * lid;
    }
    positions[index] += dx;
    positions[index + 1] += dy;
    positions[index + 2] += dz;
  }
  return positions;
}

function buildBrowTarget(basePositions) {
  const positions = basePositions.slice();
  for (let index = 0; index < positions.length; index += 3) {
    const x = basePositions[index];
    const y = basePositions[index + 1];
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (const side of [-1, 1]) {
      const brow = gaussian(x, y, side * 0.35, 0.35, 0.285, 0.115);
      const glabella = gaussian(x, y, side * 0.10, 0.31, 0.12, 0.12);
      dx += side * 0.021 * brow - side * 0.006 * glabella;
      dy += 0.105 * brow + 0.018 * glabella;
      dz += 0.046 * brow;
    }
    positions[index] += dx;
    positions[index + 1] += dy;
    positions[index + 2] += dz;
  }
  return positions;
}

const TARGET_BUILDERS = {
  smile: buildSmileTarget,
  blink: buildBlinkTarget,
  brow: buildBrowTarget,
};

export function createFaceMesh(options = {}) {
  const segments = options.segments ?? 72;
  const rings = options.rings ?? 30;
  const { positions, vertexCount } = createBaseGeometry(segments, rings);
  const { triangles, outline } = createTopology(segments, rings);
  const normals = computeVertexNormals(positions, triangles, vertexCount);
  const faceNormals = computeFaceNormals(positions, triangles);
  const targets = MORPH_TARGETS.map((definition) => {
    const targetPositions = TARGET_BUILDERS[definition.id](positions);
    return {
      ...definition,
      positions: targetPositions,
      normals: computeVertexNormals(targetPositions, triangles, vertexCount),
    };
  });

  return {
    segments,
    rings,
    vertexCount,
    base: { positions, normals },
    faceNormals,
    targets,
    triangles,
    outline,
  };
}

function normalizeWeightInput(input = {}) {
  const weights = {};
  const limited = [];
  for (const target of MORPH_TARGETS) {
    const numeric = Number(input[target.id]);
    const raw = Number.isFinite(numeric) ? numeric : 0;
    const value = clamp(raw);
    weights[target.id] = value;
    if (!Number.isFinite(numeric) || Math.abs(raw - value) > 1e-9) {
      limited.push({ id: target.id, raw, clamped: value });
    }
  }
  return { weights, limited };
}

function buildMorphedPositions(mesh, weights, safetyScale) {
  const positions = mesh.base.positions.slice();
  let totalWeight = 0;
  for (const target of mesh.targets) {
    const weight = weights[target.id] * safetyScale;
    if (weight <= 0) continue;
    totalWeight += weight;
    for (let index = 0; index < positions.length; index += 1) {
      positions[index] +=
        (target.positions[index] - mesh.base.positions[index]) * weight;
    }
  }
  return { positions, totalWeight };
}

function segmentsIntersect(a, b, c, d) {
  const abC = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const abD = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  const cdA = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
  const cdB = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
  return (
    ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
  );
}

function outlineSelfIntersects(positions, outline) {
  const count = outline.length;
  for (let first = 0; first < count; first += 1) {
    const firstNext = (first + 1) % count;
    const aIndex = outline[first] * 3;
    const bIndex = outline[firstNext] * 3;
    const a = { x: positions[aIndex], y: positions[aIndex + 1] };
    const b = { x: positions[bIndex], y: positions[bIndex + 1] };
    for (let second = first + 1; second < count; second += 1) {
      const secondNext = (second + 1) % count;
      if (
        second === first ||
        second === firstNext ||
        secondNext === first
      ) {
        continue;
      }
      const cIndex = outline[second] * 3;
      const dIndex = outline[secondNext] * 3;
      const c = { x: positions[cIndex], y: positions[cIndex + 1] };
      const d = { x: positions[dIndex], y: positions[dIndex + 1] };
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function inspectPose(mesh, positions) {
  const faceNormals = computeFaceNormals(positions, mesh.triangles);
  let triangleFlips = 0;
  for (let index = 0; index < faceNormals.length; index += 3) {
    const alignment =
      faceNormals[index] * mesh.faceNormals[index] +
      faceNormals[index + 1] * mesh.faceNormals[index + 1] +
      faceNormals[index + 2] * mesh.faceNormals[index + 2];
    if (alignment < 0.08) triangleFlips += 1;
  }
  return {
    triangleFlips,
    outlineSelfIntersects: outlineSelfIntersects(positions, mesh.outline),
  };
}

export function maxVertexDisplacement(positionsA, positionsB) {
  const length = Math.min(positionsA.length, positionsB.length);
  let maximum = 0;
  for (let index = 0; index + 2 < length; index += 3) {
    const distance = Math.hypot(
      positionsB[index] - positionsA[index],
      positionsB[index + 1] - positionsA[index + 1],
      positionsB[index + 2] - positionsA[index + 2],
    );
    if (distance > maximum) maximum = distance;
  }
  return maximum;
}

export function blendNormals(mesh, weights, safetyScale = 1) {
  const blended = new Float32Array(mesh.base.normals.length);
  for (let index = 0; index < mesh.base.normals.length; index += 3) {
    let nx = mesh.base.normals[index];
    let ny = mesh.base.normals[index + 1];
    let nz = mesh.base.normals[index + 2];
    for (const target of mesh.targets) {
      const weight = weights[target.id] * safetyScale;
      if (weight <= 0) continue;
      nx += (target.normals[index] - mesh.base.normals[index]) * weight;
      ny += (target.normals[index + 1] - mesh.base.normals[index + 1]) * weight;
      nz += (target.normals[index + 2] - mesh.base.normals[index + 2]) * weight;
    }
    const length = Math.hypot(nx, ny, nz);
    if (length < EPSILON) {
      blended[index] = mesh.base.normals[index];
      blended[index + 1] = mesh.base.normals[index + 1];
      blended[index + 2] = mesh.base.normals[index + 2];
    } else {
      blended[index] = nx / length;
      blended[index + 1] = ny / length;
      blended[index + 2] = nz / length;
    }
  }
  return blended;
}

export function applyMorphTargets(mesh, rawWeights = {}) {
  const { weights, limited } = normalizeWeightInput(rawWeights);
  let safetyScale = 1;
  let positions;
  let totalWeight = 0;
  let inspection = { triangleFlips: 0, outlineSelfIntersects: false };

  for (let attempt = 0; attempt < 36; attempt += 1) {
    const result = buildMorphedPositions(mesh, weights, safetyScale);
    positions = result.positions;
    totalWeight = result.totalWeight;
    if (totalWeight < EPSILON) {
      inspection = { triangleFlips: 0, outlineSelfIntersects: false };
      break;
    }
    inspection = inspectPose(mesh, positions);
    if (
      inspection.triangleFlips === 0 &&
      !inspection.outlineSelfIntersects
    ) {
      break;
    }
    safetyScale *= 0.82;
  }

  if (inspection.triangleFlips > 0 || inspection.outlineSelfIntersects) {
    safetyScale = 0;
    positions = mesh.base.positions.slice();
    totalWeight = 0;
    inspection = { triangleFlips: 0, outlineSelfIntersects: false };
  }

  const normals =
    totalWeight < EPSILON
      ? mesh.base.normals.slice()
      : blendNormals(mesh, weights, safetyScale);
  const appliedWeights = Object.fromEntries(
    MORPH_TARGETS.map((target) => [
      target.id,
      weights[target.id] * safetyScale,
    ]),
  );

  return {
    weights,
    appliedWeights,
    limited,
    safetyScale,
    totalWeight,
    positions,
    normals,
    triangleFlips: inspection.triangleFlips,
    outlineSelfIntersects: inspection.outlineSelfIntersects,
    maxDisplacement: maxVertexDisplacement(mesh.base.positions, positions),
  };
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function runStabilityTest(mesh, options = {}) {
  const cycles = options.cycles ?? 240;
  const random = mulberry32(options.seed ?? 0x20261118);
  const basePositions = mesh.base.positions.slice();
  const baseNormals = mesh.base.normals.slice();
  let largestIntermediateDisplacement = 0;

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const weights = {};
    for (const target of MORPH_TARGETS) {
      weights[target.id] = random() * 1.45 - 0.10;
    }
    const pose = applyMorphTargets(mesh, weights);
    largestIntermediateDisplacement = Math.max(
      largestIntermediateDisplacement,
      pose.maxDisplacement,
    );
  }

  const resetPose = applyMorphTargets(mesh, {
    smile: 0,
    blink: 0,
    brow: 0,
  });
  const maxPositionResidual = maxVertexDisplacement(
    basePositions,
    resetPose.positions,
  );
  let maxNormalResidual = 0;
  for (let index = 0; index < baseNormals.length; index += 1) {
    maxNormalResidual = Math.max(
      maxNormalResidual,
      Math.abs(resetPose.normals[index] - baseNormals[index]),
    );
  }
  const basePreserved = maxVertexDisplacement(
    mesh.base.positions,
    basePositions,
  ) === 0;

  return {
    cycles,
    maxPositionResidual,
    maxNormalResidual,
    largestIntermediateDisplacement,
    basePreserved,
    passed:
      basePreserved &&
      maxPositionResidual < 1e-7 &&
      maxNormalResidual < 1e-7,
  };
}

export function makeWeightSet(activeId, weights) {
  const result = {};
  for (const target of MORPH_TARGETS) {
    result[target.id] = target.id === activeId ? weights[target.id] : 0;
  }
  return result;
}
