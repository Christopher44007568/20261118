// Rock-strata material generator.
// Every map (albedo / roughness / normal / height / porosity) is derived from
// the SAME set of periodic fields evaluated at the SAME (u, v), so the maps
// can never drift out of alignment. Normal is Sobel-derived from the final
// height field with wrap-aware taps, keeping edges seamless.

import { hash2, pfbm2, pridged2, pvoronoi2, wrapi } from "./noise";

let texSize: i32 = 0;
let albedo: Uint8Array = new Uint8Array(0);
let roughness: Uint8Array = new Uint8Array(0);
let normal: Uint8Array = new Uint8Array(0);
let height8: Uint8Array = new Uint8Array(0);
let porosity: Uint8Array = new Uint8Array(0);
let heightF: Float32Array = new Float32Array(0);

@inline
function clamp01(x: f64): f64 {
  return x < 0.0 ? 0.0 : x > 1.0 ? 1.0 : x;
}

@inline
function smoothstep(e0: f64, e1: f64, x: f64): f64 {
  let t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3.0 - 2.0 * t);
}

@inline
function mixf(a: f64, b: f64, t: f64): f64 {
  return a + (b - a) * t;
}

@inline
function put8(dst: Uint8Array, i: i32, r: f64, g: f64, b: f64, a: f64): void {
  dst[i] = u8(clamp01(r) * 255.0 + 0.5);
  dst[i + 1] = u8(clamp01(g) * 255.0 + 0.5);
  dst[i + 2] = u8(clamp01(b) * 255.0 + 0.5);
  dst[i + 3] = u8(clamp01(a) * 255.0 + 0.5);
}

// Layer index wraps at STRATA_COUNT: band advances by exactly STRATA_COUNT
// across the v-seam, so wrapped hashes make every per-layer property periodic.
const STRATA_COUNT: i32 = 9;

@inline
function layerHash(li: i32, channel: i32, seed: i32): f32 {
  return hash2(wrapi(li, STRATA_COUNT), channel, seed);
}

// Strata relief: each layer gets a stable pseudo-random elevation; the
// profile eases across layer boundaries so height stays continuous.
function strataHeight(band: f64, seed: i32): f64 {
  let li = i32(Mathf.floor(f32(band)));
  let t = band - f64(li);
  let h0 = layerHash(li, 17, seed) - 0.5;
  let h1 = layerHash(li + 1, 17, seed) - 0.5;
  let s = t * t * (3.0 - 2.0 * t);
  return mixf(h0, h1, s);
}

export function generate(seed: i32, size: i32): void {
  if (size != texSize) {
    texSize = size;
    let n = size * size;
    albedo = new Uint8Array(n * 4);
    roughness = new Uint8Array(n * 4);
    normal = new Uint8Array(n * 4);
    height8 = new Uint8Array(n * 4);
    porosity = new Uint8Array(n * 4);
    heightF = new Float32Array(n);
  }

  const warpPeriod: i32 = 4;
  const detailPeriod: i32 = 8;
  const crackPeriod: i32 = 6;
  const porePeriod: i32 = 12;
  const crackWidth: f64 = 0.055;
  const crackDepth: f64 = 0.5;

  let hmin: f64 = 1e9;
  let hmax: f64 = -1e9;

  for (let y = 0; y < size; y++) {
    let v = f32(y) / f32(size);
    for (let x = 0; x < size; x++) {
      let u = f32(x) / f32(size);
      let idx = y * size + x;

      // --- shared fields -------------------------------------------------
      // Domain warp for the strata (periodic, so layers wrap seamlessly).
      let warp = pfbm2(u * f32(warpPeriod), v * f32(warpPeriod), warpPeriod, 4, 2.0, 0.5, seed + 11);
      let band = f64(v) * f64(STRATA_COUNT) + f64(warp) * 1.35;
      let li = i32(Mathf.floor(f32(band)));
      let layerT = band - f64(li);

      // Sediment boundary line: darkest/deepest right at layer transitions.
      let edgeDist = Math.min(layerT, 1.0 - layerT);
      let edgeLine = 1.0 - smoothstep(0.0, 0.09, edgeDist);

      // Cracks from periodic Voronoi F2-F1 ridges.
      let vor = pvoronoi2(u * f32(crackPeriod), v * f32(crackPeriod), crackPeriod, seed + 23, 0.9);
      let crack = 1.0 - smoothstep(0.0, crackWidth, vor[1] - vor[0]);

      // Detail noises.
      let mottle = pfbm2(u * f32(detailPeriod), v * f32(detailPeriod), detailPeriod, 5, 2.0, 0.55, seed + 37);
      let grain = pfbm2(u * 32.0, v * 32.0, 32, 3, 2.0, 0.5, seed + 51);
      let ridge = pridged2(u * 8.0, v * 8.0, 8, 4, seed + 67);
      let pores = pfbm2(u * f32(porePeriod), v * f32(porePeriod), porePeriod, 4, 2.0, 0.6, seed + 83);

      // --- height ----------------------------------------------------------
      let h: f64 = 0.55 * strataHeight(band, seed + 5)
        + 0.22 * f64(mottle)
        + 0.16 * f64(ridge - 0.5)
        + 0.07 * f64(grain)
        - crackDepth * crack
        - 0.12 * edgeLine;
      heightF[idx] = f32(h);
      if (h < hmin) hmin = h;
      if (h > hmax) hmax = h;

      // --- albedo ----------------------------------------------------------
      // Per-layer stable tint, blended across the boundary.
      let tint0 = layerHash(li, 31, seed + 3);
      let tint1 = layerHash(li + 1, 31, seed + 3);
      let ts = layerT * layerT * (3.0 - 2.0 * layerT);
      let tint = mixf(tint0, tint1, ts);

      // Rock palette: warm sandstone <-> cool gray shale.
      let baseMix = clamp01(0.18 + 0.68 * tint + 0.22 * mottle);
      let r = mixf(0.62, 0.38, baseMix);
      let g = mixf(0.50, 0.36, baseMix);
      let b = mixf(0.38, 0.34, baseMix);
      // Grain speckle + crack darkening + sediment line darkening.
      let shade = 1.0 + 0.16 * grain - 0.38 * crack - 0.30 * edgeLine;
      put8(albedo, idx * 4, r * shade, g * shade, b * shade, 1.0);

      // --- roughness -------------------------------------------------------
      let rough = 0.62
        + 0.22 * (f64(layerHash(li, 47, seed + 7)) - 0.5)
        + 0.14 * mottle
        + 0.10 * crack
        + 0.06 * grain;
      put8(roughness, idx * 4, rough, rough, rough, 1.0);

      // --- porosity ----------------------------------------------------------
      let pore = clamp01(0.5 + 0.55 * pores + 0.35 * crack - 0.15 * ridge);
      // Soft threshold so pores read as discrete patches.
      pore = smoothstep(0.35, 0.75, pore);
      put8(porosity, idx * 4, pore, pore, pore, 1.0);
    }
  }

  // --- normalize height, emit 8-bit height + Sobel normal (wrap-aware) -----
  let range = Math.max(hmax - hmin, 1e-6);
  const normalStrength: f32 = 2.2;
  for (let y = 0; y < size; y++) {
    let yu = (y + 1) % size;
    let yd = (y - 1 + size) % size;
    for (let x = 0; x < size; x++) {
      let idx = y * size + x;
      let hn = (heightF[idx] - hmin) / range;
      put8(height8, idx * 4, hn, hn, hn, 1.0);

      let xl = (x - 1 + size) % size;
      let xr = (x + 1) % size;
      let dx = (heightF[y * size + xr] - heightF[y * size + xl]) / range;
      let dy = (heightF[yu * size + x] - heightF[yd * size + x]) / range;
      let nx = -dx * normalStrength * 0.5;
      let ny = -dy * normalStrength * 0.5;
      let nz = 1.0 / f32(size) * 64.0; // texel-scale z so strength is resolution aware
      let inv = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      put8(normal, idx * 4, nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5, 1.0);
    }
  }
}

export function getAlbedoPtr(): usize { return albedo.dataStart; }
export function getRoughnessPtr(): usize { return roughness.dataStart; }
export function getNormalPtr(): usize { return normal.dataStart; }
export function getHeightPtr(): usize { return height8.dataStart; }
export function getPorosityPtr(): usize { return porosity.dataStart; }
export function getHeightF32Ptr(): usize { return heightF.dataStart; }
