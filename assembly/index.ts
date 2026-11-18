const LEAF_SIZE: i32 = 4;
const STACK_SIZE: i32 = 128;

let highPos = new Float32Array(0);
let highNrm = new Float32Array(0);
let highIdx = new Uint32Array(0);
let lowPos = new Float32Array(0);
let lowNrm = new Float32Array(0);
let lowTan = new Float32Array(0);
let lowBit = new Float32Array(0);
let lowUv = new Float32Array(0);
let lowIdx = new Uint32Array(0);
let cagePos = new Float32Array(0);

let order = new Uint32Array(0);
let nodeBounds = new Float32Array(0);
let nodeStart = new Int32Array(0);
let nodeCount = new Int32Array(0);
let nodeLeft = new Int32Array(0);
let nodeRight = new Int32Array(0);
let nodeCursor: i32 = 0;
let highTriangleCount: i32 = 0;

let output = new Float32Array(0);
let texWidth: i32 = 0;
let texHeight: i32 = 0;
let projectionMode: i32 = 0;
let rayDistance: f32 = 0.24;
let weightScale: f32 = 8.0;
let maxHits: i32 = 8;

let hitU: f32 = 0.0;
let hitV: f32 = 0.0;
let nearestDistSq: f32 = f32.MAX_VALUE;
let nearestX: f32 = 0.0;
let nearestY: f32 = 0.0;
let nearestZ: f32 = 0.0;
let closestX: f32 = 0.0;
let closestY: f32 = 0.0;
let closestZ: f32 = 0.0;
let traversalStack = new Int32Array(STACK_SIZE);

let lastHitPixels: i32 = 0;
let lastZeroPixels: i32 = 0;
let lastTotalHits: i32 = 0;
let lastMaxHits: i32 = 0;
let lastAvgDistance: f32 = 0.0;
let accumX: f32 = 0.0;
let accumY: f32 = 0.0;
let accumZ: f32 = 0.0;
let firstHitDistance: f32 = 0.0;
let totalBoxTests: i64 = 0;
let totalTriangleTests: i64 = 0;

export function resizeMeshes(highVertices: i32, highTriangles: i32, lowVertices: i32, lowTriangles: i32): void {
  highPos = new Float32Array(highVertices * 3);
  highNrm = new Float32Array(highVertices * 3);
  highIdx = new Uint32Array(highTriangles * 3);
  lowPos = new Float32Array(lowVertices * 3);
  lowNrm = new Float32Array(lowVertices * 3);
  lowTan = new Float32Array(lowVertices * 3);
  lowBit = new Float32Array(lowVertices * 3);
  lowUv = new Float32Array(lowVertices * 2);
  lowIdx = new Uint32Array(lowTriangles * 3);
  cagePos = new Float32Array(lowVertices * 3);

  const nodeCapacity = highTriangles * 2 + 5;
  order = new Uint32Array(highTriangles);
  nodeBounds = new Float32Array(nodeCapacity * 6);
  nodeStart = new Int32Array(nodeCapacity);
  nodeCount = new Int32Array(nodeCapacity);
  nodeLeft = new Int32Array(nodeCapacity);
  nodeRight = new Int32Array(nodeCapacity);
  highTriangleCount = highTriangles;
}

export function resizeTexture(width: i32, height: i32): void {
  texWidth = width;
  texHeight = height;
  output = new Float32Array(width * height * 4);
}

export function configure(projection: i32, distance: f32, weights: f32, hits: i32): void {
  projectionMode = projection;
  rayDistance = distance;
  weightScale = weights;
  maxHits = max<i32>(1, min<i32>(hits, 32));
}

export function highPosPtr(): usize { return highPos.dataStart; }
export function highNrmPtr(): usize { return highNrm.dataStart; }
export function highIdxPtr(): usize { return highIdx.dataStart; }
export function lowPosPtr(): usize { return lowPos.dataStart; }
export function lowNrmPtr(): usize { return lowNrm.dataStart; }
export function lowTanPtr(): usize { return lowTan.dataStart; }
export function lowBitPtr(): usize { return lowBit.dataStart; }
export function lowUvPtr(): usize { return lowUv.dataStart; }
export function lowIdxPtr(): usize { return lowIdx.dataStart; }
export function cagePosPtr(): usize { return cagePos.dataStart; }
export function outputPtr(): usize { return output.dataStart; }

export function getHitPixels(): i32 { return lastHitPixels; }
export function getZeroPixels(): i32 { return lastZeroPixels; }
export function getTotalHits(): i32 { return lastTotalHits; }
export function getMaxHits(): i32 { return lastMaxHits; }
export function getAvgDistance(): f32 { return lastAvgDistance; }
export function getTextureWidth(): i32 { return texWidth; }
export function getTextureHeight(): i32 { return texHeight; }
export function getBoxTests(): i64 { return totalBoxTests; }
export function getTriangleTests(): i64 { return totalTriangleTests; }

@inline
function triCoord(tri: i32, axis: i32): f32 {
  const base = tri * 3;
  return (highPos[highIdx[base] * 3 + axis] +
    highPos[highIdx[base + 1] * 3 + axis] +
    highPos[highIdx[base + 2] * 3 + axis]) * (1.0 / 3.0);
}

function selectKth(lo: i32, hi: i32, k: i32, axis: i32): void {
  while (hi > lo) {
    const middle = (lo + hi) >> 1;
    const pivot = triCoord(order[middle], axis);
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (triCoord(order[i], axis) < pivot) i++;
      while (triCoord(order[j], axis) > pivot) j--;
      if (i <= j) {
        const swap = order[i];
        order[i] = order[j];
        order[j] = swap;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

function buildNode(start: i32, count: i32, depth: i32): i32 {
  const node = nodeCursor++;
  nodeStart[node] = start;
  nodeCount[node] = count;
  nodeLeft[node] = -1;
  nodeRight[node] = -1;

  let minX = f32.MAX_VALUE, minY = f32.MAX_VALUE, minZ = f32.MAX_VALUE;
  let maxX = -f32.MAX_VALUE, maxY = -f32.MAX_VALUE, maxZ = -f32.MAX_VALUE;
  let cMinX = f32.MAX_VALUE, cMinY = f32.MAX_VALUE, cMinZ = f32.MAX_VALUE;
  let cMaxX = -f32.MAX_VALUE, cMaxY = -f32.MAX_VALUE, cMaxZ = -f32.MAX_VALUE;

  for (let i = start; i < start + count; i++) {
    const tri = order[i];
    const base = tri * 3;
    const a = highIdx[base] * 3;
    const b = highIdx[base + 1] * 3;
    const c = highIdx[base + 2] * 3;
    const ax = highPos[a], ay = highPos[a + 1], az = highPos[a + 2];
    const bx = highPos[b], by = highPos[b + 1], bz = highPos[b + 2];
    const cx = highPos[c], cy = highPos[c + 1], cz = highPos[c + 2];
    minX = min<f32>(minX, min<f32>(ax, min<f32>(bx, cx)));
    minY = min<f32>(minY, min<f32>(ay, min<f32>(by, cy)));
    minZ = min<f32>(minZ, min<f32>(az, min<f32>(bz, cz)));
    maxX = max<f32>(maxX, max<f32>(ax, max<f32>(bx, cx)));
    maxY = max<f32>(maxY, max<f32>(ay, max<f32>(by, cy)));
    maxZ = max<f32>(maxZ, max<f32>(az, max<f32>(bz, cz)));
    const mx = (ax + bx + cx) * (1.0 / 3.0);
    const my = (ay + by + cy) * (1.0 / 3.0);
    const mz = (az + bz + cz) * (1.0 / 3.0);
    cMinX = min<f32>(cMinX, mx); cMinY = min<f32>(cMinY, my); cMinZ = min<f32>(cMinZ, mz);
    cMaxX = max<f32>(cMaxX, mx); cMaxY = max<f32>(cMaxY, my); cMaxZ = max<f32>(cMaxZ, mz);
  }

  const b = node * 6;
  nodeBounds[b] = minX; nodeBounds[b + 1] = minY; nodeBounds[b + 2] = minZ;
  nodeBounds[b + 3] = maxX; nodeBounds[b + 4] = maxY; nodeBounds[b + 5] = maxZ;

  if (count <= LEAF_SIZE || depth >= 32) return node;

  const ex = cMaxX - cMinX, ey = cMaxY - cMinY, ez = cMaxZ - cMinZ;
  let axis = 0;
  if (ey > ex && ey >= ez) axis = 1;
  else if (ez > ex && ez > ey) axis = 2;
  const middle = start + (count >> 1);
  selectKth(start, start + count - 1, middle, axis);
  const half = count >> 1;
  nodeLeft[node] = buildNode(start, half, depth + 1);
  nodeRight[node] = buildNode(start + half, count - half, depth + 1);
  return node;
}

function buildBvh(): void {
  nodeCursor = 0;
  for (let i = 0; i < highTriangleCount; i++) order[i] = i;
  if (highTriangleCount > 0) buildNode(0, highTriangleCount, 0);
}

function rayBox(node: i32, ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32, maxT: f32): bool {
  const b = node * 6;
  let tMin: f32 = 0.0;
  let tMax: f32 = maxT;
  if (abs<f32>(dx) < 1e-12) {
    if (ox < nodeBounds[b] || ox > nodeBounds[b + 3]) return false;
  } else {
    const inv: f32 = f32(1.0) / dx;
    let t1: f32 = (nodeBounds[b] - ox) * inv;
    let t2: f32 = (nodeBounds[b + 3] - ox) * inv;
    if (t1 > t2) { const t: f32 = t1; t1 = t2; t2 = t; }
    tMin = max<f32>(tMin, t1);
    tMax = min<f32>(tMax, t2);
    if (tMin > tMax) return false;
  }
  if (abs<f32>(dy) < 1e-12) {
    if (oy < nodeBounds[b + 1] || oy > nodeBounds[b + 4]) return false;
  } else {
    const inv: f32 = f32(1.0) / dy;
    let t1: f32 = (nodeBounds[b + 1] - oy) * inv;
    let t2: f32 = (nodeBounds[b + 4] - oy) * inv;
    if (t1 > t2) { const t: f32 = t1; t1 = t2; t2 = t; }
    tMin = max<f32>(tMin, t1);
    tMax = min<f32>(tMax, t2);
    if (tMin > tMax) return false;
  }
  if (abs<f32>(dz) < 1e-12) {
    if (oz < nodeBounds[b + 2] || oz > nodeBounds[b + 5]) return false;
  } else {
    const inv: f32 = f32(1.0) / dz;
    let t1: f32 = (nodeBounds[b + 2] - oz) * inv;
    let t2: f32 = (nodeBounds[b + 5] - oz) * inv;
    if (t1 > t2) { const t: f32 = t1; t1 = t2; t2 = t; }
    tMin = max<f32>(tMin, t1);
    tMax = min<f32>(tMax, t2);
    if (tMin > tMax) return false;
  }
  return tMax >= 0.0;
}

function rayTriangle(tri: i32, ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32): f32 {
  const base = tri * 3;
  const ia = highIdx[base] * 3;
  const ib = highIdx[base + 1] * 3;
  const ic = highIdx[base + 2] * 3;
  const ax = highPos[ia], ay = highPos[ia + 1], az = highPos[ia + 2];
  const e1x = highPos[ib] - ax, e1y = highPos[ib + 1] - ay, e1z = highPos[ib + 2] - az;
  const e2x = highPos[ic] - ax, e2y = highPos[ic + 1] - ay, e2z = highPos[ic + 2] - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (abs<f32>(det) < 1e-10) return -1.0;
  const invDet: f32 = f32(1.0) / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u: f32 = (tx * px + ty * py + tz * pz) * invDet;
  if (u < -1e-6 || u > 1.0 + 1e-6) return -1.0;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v: f32 = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < -1e-6 || u + v > 1.0 + 1e-6) return -1.0;
  hitU = u;
  hitV = v;
  return (e2x * qx + e2y * qy + e2z * qz) * invDet;
}

function updateNearest(px: f32, py: f32, pz: f32): void {
  const dx = closestX - px, dy = closestY - py, dz = closestZ - pz;
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq < nearestDistSq) {
    nearestDistSq = distSq;
    nearestX = closestX;
    nearestY = closestY;
    nearestZ = closestZ;
  }
}

function closestOnTriangle(tri: i32, px: f32, py: f32, pz: f32): void {
  const base = tri * 3;
  const ia = highIdx[base] * 3;
  const ib = highIdx[base + 1] * 3;
  const ic = highIdx[base + 2] * 3;
  const ax = highPos[ia], ay = highPos[ia + 1], az = highPos[ia + 2];
  const bx = highPos[ib], by = highPos[ib + 1], bz = highPos[ib + 2];
  const cx = highPos[ic], cy = highPos[ic + 1], cz = highPos[ic + 2];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0.0 && d2 <= 0.0) {
    closestX = ax; closestY = ay; closestZ = az;
    updateNearest(px, py, pz);
    return;
  }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0.0 && d4 <= d3) {
    closestX = bx; closestY = by; closestZ = bz;
    updateNearest(px, py, pz);
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
    const v = d1 / (d1 - d3);
    closestX = ax + v * abx; closestY = ay + v * aby; closestZ = az + v * abz;
    updateNearest(px, py, pz);
    return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0.0 && d5 <= d6) {
    closestX = cx; closestY = cy; closestZ = cz;
    updateNearest(px, py, pz);
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
    const w = d2 / (d2 - d6);
    closestX = ax + w * acx; closestY = ay + w * acy; closestZ = az + w * acz;
    updateNearest(px, py, pz);
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    closestX = bx + w * (cx - bx); closestY = by + w * (cy - by); closestZ = bz + w * (cz - bz);
    updateNearest(px, py, pz);
    return;
  }
  const denom: f32 = f32(1.0) / (va + vb + vc);
  const v: f32 = vb * denom;
  const w: f32 = vc * denom;
  closestX = ax + abx * v + acx * w;
  closestY = ay + aby * v + acy * w;
  closestZ = az + abz * v + acz * w;
  updateNearest(px, py, pz);
}

function pointBoxDistSq(node: i32, px: f32, py: f32, pz: f32): f32 {
  const b = node * 6;
  const dx = max<f32>(max<f32>(nodeBounds[b] - px, 0.0), px - nodeBounds[b + 3]);
  const dy = max<f32>(max<f32>(nodeBounds[b + 1] - py, 0.0), py - nodeBounds[b + 4]);
  const dz = max<f32>(max<f32>(nodeBounds[b + 2] - pz, 0.0), pz - nodeBounds[b + 5]);
  return dx * dx + dy * dy + dz * dz;
}

function findNearest(px: f32, py: f32, pz: f32): void {
  nearestDistSq = f32.MAX_VALUE;
  nearestX = px; nearestY = py; nearestZ = pz;
  if (highTriangleCount == 0) return;
  let top = 0;
  traversalStack[top++] = 0;
  while (top > 0) {
    const node = traversalStack[--top];
    if (pointBoxDistSq(node, px, py, pz) >= nearestDistSq) continue;
    if (nodeLeft[node] < 0) {
      const start = nodeStart[node];
      for (let i = start; i < start + nodeCount[node]; i++) {
        closestOnTriangle(order[i], px, py, pz);
      }
    } else {
      const left = nodeLeft[node], right = nodeRight[node];
      const dl = pointBoxDistSq(left, px, py, pz);
      const dr = pointBoxDistSq(right, px, py, pz);
      if (dl < dr) {
        if (dr < nearestDistSq) traversalStack[top++] = right;
        if (dl < nearestDistSq) traversalStack[top++] = left;
      } else {
        if (dl < nearestDistSq) traversalStack[top++] = left;
        if (dr < nearestDistSq) traversalStack[top++] = right;
      }
    }
  }
}

function traceWeighted(
  ox: f32, oy: f32, oz: f32,
  dx: f32, dy: f32, dz: f32,
  nlx: f32, nly: f32, nlz: f32,
  tx: f32, ty: f32, tz: f32,
  bx: f32, by: f32, bz: f32
): i32 {
  accumX = 0.0; accumY = 0.0; accumZ = 0.0;
  firstHitDistance = rayDistance;
  if (highTriangleCount == 0) return 0;
  let hits = 0;
  let top = 0;
  traversalStack[top++] = 0;
  while (top > 0 && hits < maxHits) {
    const node = traversalStack[--top];
    totalBoxTests++;
    if (!rayBox(node, ox, oy, oz, dx, dy, dz, rayDistance)) continue;
    if (nodeLeft[node] < 0) {
      const start = nodeStart[node];
      for (let i = start; i < start + nodeCount[node] && hits < maxHits; i++) {
        const tri = order[i];
        totalTriangleTests++;
        const t = rayTriangle(tri, ox, oy, oz, dx, dy, dz);
        if (t <= 1e-5 || t > rayDistance) continue;
        const base = tri * 3;
        const ia = highIdx[base] * 3;
        const ib = highIdx[base + 1] * 3;
        const ic = highIdx[base + 2] * 3;
        const w0: f32 = f32(1.0) - hitU - hitV;
        const u: f32 = hitU, v: f32 = hitV;
        let nx: f32 = highNrm[ia] * w0 + highNrm[ib] * u + highNrm[ic] * v;
        let ny: f32 = highNrm[ia + 1] * w0 + highNrm[ib + 1] * u + highNrm[ic + 1] * v;
        let nz: f32 = highNrm[ia + 2] * w0 + highNrm[ib + 2] * u + highNrm[ic + 2] * v;
        const nlen: f32 = Mathf.sqrt(nx * nx + ny * ny + nz * nz);
        if (nlen < 1e-8) continue;
        nx /= nlen; ny /= nlen; nz /= nlen;
        const localX: f32 = nx * tx + ny * ty + nz * tz;
        const localY: f32 = nx * bx + ny * by + nz * bz;
        const localZ: f32 = nx * nlx + ny * nly + nz * nlz;
        const localLen: f32 = Mathf.sqrt(localX * localX + localY * localY + localZ * localZ);
        if (localLen < 1e-8) continue;
        const scaled: f32 = f32(1.0) / (f32(1.0) + t * weightScale * (t * weightScale));
        const weight: f32 = scaled / localLen;
        accumX += localX * weight;
        accumY += localY * weight;
        accumZ += localZ * weight;
        if (hits == 0) firstHitDistance = t;
        hits++;
      }
    } else {
      traversalStack[top++] = nodeLeft[node];
      traversalStack[top++] = nodeRight[node];
    }
  }
  return hits;
}

function writeNeutral(pixel: i32): void {
  output[pixel * 4] = 0.5;
  output[pixel * 4 + 1] = 0.5;
  output[pixel * 4 + 2] = 1.0;
  output[pixel * 4 + 3] = 0.0;
}

export function bake(): usize {
  buildBvh();
  lastHitPixels = 0;
  lastTotalHits = 0;
  lastMaxHits = 0;
  lastAvgDistance = 0.0;
  totalBoxTests = 0;
  totalTriangleTests = 0;
  const pixels = texWidth * texHeight;
  for (let pixel = 0; pixel < pixels; pixel++) writeNeutral(pixel);

  const lowTriangleCount = lowIdx.length / 3;
  for (let triangle = 0; triangle < lowTriangleCount; triangle++) {
    const ia = lowIdx[triangle * 3];
    const ib = lowIdx[triangle * 3 + 1];
    const ic = lowIdx[triangle * 3 + 2];
    const au = lowUv[ia * 2], av = lowUv[ia * 2 + 1];
    const bu = lowUv[ib * 2], bv = lowUv[ib * 2 + 1];
    const cu = lowUv[ic * 2], cv = lowUv[ic * 2 + 1];
    const area = (bu - au) * (cv - av) - (bv - av) * (cu - au);
    if (abs<f32>(area) < 1e-12) continue;

    const minX = max<i32>(0, <i32>Mathf.floor(min<f32>(au, min<f32>(bu, cu)) * f32(texWidth) - 0.5));
    const maxX = min<i32>(texWidth - 1, <i32>Mathf.ceil(max<f32>(au, max<f32>(bu, cu)) * f32(texWidth) - 0.5));
    const minY = max<i32>(0, <i32>Mathf.floor(min<f32>(av, min<f32>(bv, cv)) * f32(texHeight) - 0.5));
    const maxY = min<i32>(texHeight - 1, <i32>Mathf.ceil(max<f32>(av, max<f32>(bv, cv)) * f32(texHeight) - 0.5));

    for (let y = minY; y <= maxY; y++) {
      const py: f32 = (f32(y) + f32(0.5)) / f32(texHeight);
      for (let x = minX; x <= maxX; x++) {
        const px: f32 = (f32(x) + f32(0.5)) / f32(texWidth);
        const w0: f32 = ((bu - px) * (cv - py) - (bv - py) * (cu - px)) / area;
        const w1: f32 = ((cu - px) * (av - py) - (cv - py) * (au - px)) / area;
        const w2: f32 = f32(1.0) - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;

        const ox: f32 = lowPos[ia * 3] * w0 + lowPos[ib * 3] * w1 + lowPos[ic * 3] * w2;
        const oy: f32 = lowPos[ia * 3 + 1] * w0 + lowPos[ib * 3 + 1] * w1 + lowPos[ic * 3 + 1] * w2;
        const oz: f32 = lowPos[ia * 3 + 2] * w0 + lowPos[ib * 3 + 2] * w1 + lowPos[ic * 3 + 2] * w2;
        let nlx: f32 = lowNrm[ia * 3] * w0 + lowNrm[ib * 3] * w1 + lowNrm[ic * 3] * w2;
        let nly: f32 = lowNrm[ia * 3 + 1] * w0 + lowNrm[ib * 3 + 1] * w1 + lowNrm[ic * 3 + 1] * w2;
        let nlz: f32 = lowNrm[ia * 3 + 2] * w0 + lowNrm[ib * 3 + 2] * w1 + lowNrm[ic * 3 + 2] * w2;
        const nlen: f32 = Mathf.sqrt(nlx * nlx + nly * nly + nlz * nlz);
        if (nlen < 1e-8) continue;
        nlx /= nlen; nly /= nlen; nlz /= nlen;
        let tx: f32 = lowTan[ia * 3] * w0 + lowTan[ib * 3] * w1 + lowTan[ic * 3] * w2;
        let ty: f32 = lowTan[ia * 3 + 1] * w0 + lowTan[ib * 3 + 1] * w1 + lowTan[ic * 3 + 1] * w2;
        let tz: f32 = lowTan[ia * 3 + 2] * w0 + lowTan[ib * 3 + 2] * w1 + lowTan[ic * 3 + 2] * w2;
        let bx: f32 = lowBit[ia * 3] * w0 + lowBit[ib * 3] * w1 + lowBit[ic * 3] * w2;
        let by: f32 = lowBit[ia * 3 + 1] * w0 + lowBit[ib * 3 + 1] * w1 + lowBit[ic * 3 + 1] * w2;
        let bz: f32 = lowBit[ia * 3 + 2] * w0 + lowBit[ib * 3 + 2] * w1 + lowBit[ic * 3 + 2] * w2;
        const tlen: f32 = Mathf.sqrt(tx * tx + ty * ty + tz * tz);
        const blen: f32 = Mathf.sqrt(bx * bx + by * by + bz * bz);
        if (tlen < 1e-8 || blen < 1e-8) continue;
        tx /= tlen; ty /= tlen; tz /= tlen;
        bx /= blen; by /= blen; bz /= blen;

        let dx: f32 = 0.0, dy: f32 = 0.0, dz: f32 = 0.0;
        if (projectionMode == 0) {
          const cx: f32 = cagePos[ia * 3] * w0 + cagePos[ib * 3] * w1 + cagePos[ic * 3] * w2;
          const cy: f32 = cagePos[ia * 3 + 1] * w0 + cagePos[ib * 3 + 1] * w1 + cagePos[ic * 3 + 1] * w2;
          const cz: f32 = cagePos[ia * 3 + 2] * w0 + cagePos[ib * 3 + 2] * w1 + cagePos[ic * 3 + 2] * w2;
          dx = cx - ox; dy = cy - oy; dz = cz - oz;
        } else {
          findNearest(ox, oy, oz);
          dx = nearestX - ox; dy = nearestY - oy; dz = nearestZ - oz;
        }
        let dlen: f32 = Mathf.sqrt(dx * dx + dy * dy + dz * dz);
        if (dlen < 1e-8) {
          dx = nlx; dy = nly; dz = nlz;
          dlen = 1.0;
        }
        dx /= dlen; dy /= dlen; dz /= dlen;

        const hits = traceWeighted(ox, oy, oz, dx, dy, dz, nlx, nly, nlz, tx, ty, tz, bx, by, bz);
        const pixel = y * texWidth + x;
        if (hits == 0) {
          writeNeutral(pixel);
          continue;
        }
        const alen: f32 = Mathf.sqrt(accumX * accumX + accumY * accumY + accumZ * accumZ);
        if (alen < 1e-8) {
          writeNeutral(pixel);
          continue;
        }
        output[pixel * 4] = accumX / alen * f32(0.5) + f32(0.5);
        output[pixel * 4 + 1] = accumY / alen * f32(0.5) + f32(0.5);
        output[pixel * 4 + 2] = accumZ / alen * f32(0.5) + f32(0.5);
        output[pixel * 4 + 3] = 1.0;
        lastHitPixels++;
        lastTotalHits += hits;
        lastMaxHits = max<i32>(lastMaxHits, hits);
        lastAvgDistance += firstHitDistance;
      }
    }
  }
  if (lastHitPixels > 0) lastAvgDistance /= f32(lastHitPixels);
  lastZeroPixels = pixels - lastHitPixels;
  return output.dataStart;
}
