// Shared terrain core: deterministic heightfield used identically by the
// WebGL renderer (mirrored in GLSL) and the Node verification harness.

export const CHUNK_SIZE = 64;          // world units per chunk edge
export const WORLD_CHUNKS = 20;        // world is WORLD_CHUNKS^2 chunks
export const WORLD_SIZE = CHUNK_SIZE * WORLD_CHUNKS;
export const LEVELS = 4;
export const RESOLUTIONS = [64, 32, 16, 8]; // quads per chunk edge per LOD
export const LOD_BASE = 96;            // level L covers d in [2^L*B, 2^(L+1)*B)
export const MORPH_FRAC = 0.35;        // morph band = last 35% before switch

// --- hashing / value noise (must match GLSL in src/glsl.js exactly) ---

export function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function hashf(ix, iz) {
  return (hash2(ix, iz) & 0xffffff) / 16777216;
}

export function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hashf(ix, iz), b = hashf(ix + 1, iz);
  const c = hashf(ix, iz + 1), d = hashf(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

export function fbm(x, z, octaves) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x, z);
    norm += amp;
    x = x * 2.0 + 13.7;
    z = z * 2.0 - 7.1;
    amp *= 0.5;
  }
  return sum / norm;
}

export function ridged(x, z, octaves) {
  let sum = 0, amp = 0.55, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise(x, z);
    const r = 1 - Math.abs(2 * n - 1);
    sum += amp * r * r;
    norm += amp;
    x = x * 2.1 + 31.3;
    z = z * 2.1 + 17.9;
    amp *= 0.5;
  }
  return sum / norm;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Analytic terrain height. Pure function of (x, z): every chunk evaluates the
// same value at shared boundary coordinates, so neighbours always agree on
// boundary heights by construction.
export function terrainHeight(x, z) {
  const continent = fbm(x * 0.0012 + 3.1, z * 0.0012 - 1.7, 4);
  const mount = ridged(x * 0.0035 + 7.3, z * 0.0035 - 2.1, 5);
  const mask = smoothstep(0.42, 0.72, continent);
  const detail = fbm(x * 0.018 + 11.0, z * 0.018 + 5.0, 3);
  return (continent - 0.5) * 56 + mask * mount * mount * 230 + (detail - 0.5) * 12;
}

// --- LOD selection ---

export function lodLevelForDistance(d) {
  const l = Math.floor(Math.log2(Math.max(d, 1e-6) / LOD_BASE));
  return Math.max(0, Math.min(LEVELS - 1, l));
}

// Distance at which a chunk of level L would switch to L+1.
export function switchDistance(level) {
  return LOD_BASE * Math.pow(2, level + 1);
}

// Per-chunk uniform morph factor: 0 far from switch, 1 exactly at the switch
// distance, so the fully-morphed level-L mesh coincides with level L+1.
export function morphFactor(level, dist) {
  if (level >= LEVELS - 1) return 0;
  const end = switchDistance(level);
  const start = end * (1 - MORPH_FRAC);
  return Math.min(1, Math.max(0, (dist - start) / (end - start)));
}

export function trianglesForLevel(level) {
  const n = RESOLUTIONS[level];
  return n * n * 2;
}
