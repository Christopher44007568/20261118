// Procedural humanoid mesh: tubes along bone segments plus a head sphere.
// Every vertex carries up to 4 (joint, weight) influences; weights are
// normalized so they sum to exactly 1.
import { Vec3 } from './math.js';
import { BONES, boneIndex } from './rig.js';

const BI = (n) => boneIndex(n);

// Tube segments: from joint `a` to joint `b` (or to an explicit `tip`).
const SEGMENTS = [
  { a: 'hips',      b: 'spine',     r: 0.150 },
  { a: 'spine',     b: 'chest',     r: 0.160 },
  { a: 'chest',     b: 'neck',      r: 0.150 },
  { a: 'neck',      b: 'head',      r: 0.055 },
  { a: 'upperArmL', b: 'lowerArmL', r: 0.050 },
  { a: 'lowerArmL', b: 'handL',     r: 0.043 },
  { a: 'handL',     tip: [0.83, 1.40, 0.00],  r: 0.038 },
  { a: 'upperArmR', b: 'lowerArmR', r: 0.050 },
  { a: 'lowerArmR', b: 'handR',     r: 0.043 },
  { a: 'handR',     tip: [-0.83, 1.40, 0.00], r: 0.038 },
  { a: 'upperLegL', b: 'lowerLegL', r: 0.075 },
  { a: 'lowerLegL', b: 'footL',     r: 0.058 },
  { a: 'footL',     tip: [0.10, 0.06, 0.17],  r: 0.050 },
  { a: 'upperLegR', b: 'lowerLegR', r: 0.075 },
  { a: 'lowerLegR', b: 'footR',     r: 0.058 },
  { a: 'footR',     tip: [-0.10, 0.06, 0.17], r: 0.050 },
];

const RINGS = 6;
const SIDES = 10;

function basis(dir) {
  const w = Vec3.normalize(dir);
  const up = Math.abs(w[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = Vec3.normalize(Vec3.cross(up, w));
  const v = Vec3.cross(w, u);
  return [u, v];
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function buildMesh() {
  const positions = [];
  const normals = [];
  const joints = [];
  const weights = [];
  const indices = [];

  const pushVertex = (p, n, j, w) => {
    const sum = w.reduce((s, x) => s + x, 0) || 1;
    const wn = w.map((x) => x / sum); // normalize
    while (j.length < 4) { j.push(0); wn.push(0); }
    positions.push(...p);
    normals.push(...n);
    joints.push(...j.slice(0, 4));
    weights.push(...wn.slice(0, 4));
    return positions.length / 3 - 1;
  };

  for (const seg of SEGMENTS) {
    const ia = BI(seg.a);
    const ib = seg.b ? BI(seg.b) : -1;
    const pa = BONES[ia].parent;
    const p0 = BONES[ia].bindPos;
    const p1 = seg.b ? BONES[ib].bindPos : seg.tip;
    const dir = Vec3.sub(p1, p0);
    const [u, v] = basis(dir);
    const ringStart = positions.length / 3;

    for (let r = 0; r <= RINGS; r++) {
      const t = r / RINGS;
      const c = Vec3.add(p0, Vec3.scale(dir, t));
      // Blend toward parent joint near the start, toward child joint near
      // the end — this keeps knees/elbows smooth instead of collapsing.
      const wParent = pa >= 0 && ia !== 0 ? 0.5 * (1 - smoothstep(0, 0.4, t)) : 0;
      const wChild = ib >= 0 ? 0.5 * smoothstep(0.6, 1, t) : 0;
      const wSelf = Math.max(0, 1 - wParent - wChild);
      const j = [ia];
      const w = [wSelf];
      if (wParent > 0) { j.push(pa); w.push(wParent); }
      if (wChild > 0) { j.push(ib); w.push(wChild); }
      for (let s = 0; s < SIDES; s++) {
        const th = (s / SIDES) * Math.PI * 2;
        const n = Vec3.add(Vec3.scale(u, Math.cos(th)), Vec3.scale(v, Math.sin(th)));
        pushVertex(Vec3.add(c, Vec3.scale(n, seg.r)), n, j.slice(), w.slice());
      }
    }
    for (let r = 0; r < RINGS; r++) {
      for (let s = 0; s < SIDES; s++) {
        const a0 = ringStart + r * SIDES + s;
        const b0 = ringStart + r * SIDES + ((s + 1) % SIDES);
        const a1 = a0 + SIDES;
        const b1 = b0 + SIDES;
        indices.push(a0, a1, b0, b0, a1, b1);
      }
    }
  }

  // Head sphere centered slightly above the head joint.
  const headC = [0, 1.63, 0];
  const headR = 0.115;
  const iHead = BI('head');
  const iNeck = BI('neck');
  const sStart = positions.length / 3;
  const SR = 6, SS = 10;
  for (let r = 0; r <= SR; r++) {
    const phi = (r / SR) * Math.PI;
    for (let s = 0; s < SS; s++) {
      const th = (s / SS) * Math.PI * 2;
      const n = [
        Math.sin(phi) * Math.cos(th),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(th),
      ];
      const p = Vec3.add(headC, Vec3.scale(n, headR));
      const wNeck = 0.5 * smoothstep(0.35, 0.05, n[1]); // blend at jaw
      pushVertex(p, n, [iHead, iNeck], [1 - wNeck, wNeck]);
    }
  }
  for (let r = 0; r < SR; r++) {
    for (let s = 0; s < SS; s++) {
      const a0 = sStart + r * SS + s;
      const b0 = sStart + r * SS + ((s + 1) % SS);
      indices.push(a0, a0 + SS, b0, b0, a0 + SS, b0 + SS);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    joints: new Uint16Array(joints),
    weights: new Float32Array(weights),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 3,
  };
}

// CPU linear-blend skinning, mirroring the GPU shader exactly.
export function skinCPU(mesh, boneMats) {
  const out = new Float32Array(mesh.positions.length);
  const { positions, joints, weights, vertexCount } = mesh;
  for (let v = 0; v < vertexCount; v++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights[v * 4 + k];
      if (w === 0) continue;
      const m = boneMats[joints[v * 4 + k]];
      const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
      x += w * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
      y += w * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
      z += w * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
    }
    out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z;
  }
  return out;
}

export function computeAABB(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  return { min, max };
}
