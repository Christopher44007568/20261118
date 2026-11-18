// Periodic (tileable) noise primitives shared by every material map.
// All lattices wrap at integer `period`, so sampling at u*period / v*period
// yields textures that tile seamlessly on all four edges.

// Deterministic 2D integer hash -> [0, 1). PCG-style bit mixing.
export function hash2(ix: i32, iy: i32, seed: i32): f32 {
  let h: u32 = u32(ix) * 0x8da6b343 + u32(iy) * 0xd8163841 + u32(seed) * 0xcb1ab31f;
  h ^= h >> 13;
  h *= 0x9e3779b9;
  h ^= h >> 16;
  h *= 0x85ebca6b;
  h ^= h >> 13;
  return f32(h & 0xffffff) / f32(0x1000000);
}

@inline
function quintic(t: f32): f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

@inline
export function wrapi(x: i32, period: i32): i32 {
  let r = x % period;
  return r < 0 ? r + period : r;
}

// Periodic 2D gradient (Perlin-style) noise, output roughly in [-1, 1].
export function pnoise2(x: f32, y: f32, period: i32, seed: i32): f32 {
  let ix = i32(Mathf.floor(x));
  let iy = i32(Mathf.floor(y));
  let fx = x - f32(ix);
  let fy = y - f32(iy);

  let x0 = wrapi(ix, period);
  let x1 = wrapi(ix + 1, period);
  let y0 = wrapi(iy, period);
  let y1 = wrapi(iy + 1, period);

  // Gradient vectors from hash angle.
  let a00 = hash2(x0, y0, seed) * 6.2831853;
  let a10 = hash2(x1, y0, seed) * 6.2831853;
  let a01 = hash2(x0, y1, seed) * 6.2831853;
  let a11 = hash2(x1, y1, seed) * 6.2831853;

  let d00 = Mathf.cos(a00) * fx + Mathf.sin(a00) * fy;
  let d10 = Mathf.cos(a10) * (fx - 1.0) + Mathf.sin(a10) * fy;
  let d01 = Mathf.cos(a01) * fx + Mathf.sin(a01) * (fy - 1.0);
  let d11 = Mathf.cos(a11) * (fx - 1.0) + Mathf.sin(a11) * (fy - 1.0);

  let u = quintic(fx);
  let v = quintic(fy);
  let nx0 = d00 + (d10 - d00) * u;
  let nx1 = d01 + (d11 - d01) * u;
  return (nx0 + (nx1 - nx0) * v) * 1.4142;
}

// Periodic fBm. Every octave keeps an integer period so the sum stays tileable.
export function pfbm2(
  x: f32,
  y: f32,
  basePeriod: i32,
  octaves: i32,
  lacunarity: f32,
  gain: f32,
  seed: i32
): f32 {
  let sum: f32 = 0.0;
  let amp: f32 = 1.0;
  let freq: f32 = 1.0;
  let norm: f32 = 0.0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise2(x * freq, y * freq, period, seed + o * 101);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
    period = i32(Mathf.round(f32(period) * lacunarity));
    if (period < 1) period = 1;
  }
  return sum / norm;
}

// Periodic ridged fBm (sharp crests), output in [0, 1].
export function pridged2(
  x: f32,
  y: f32,
  basePeriod: i32,
  octaves: i32,
  seed: i32
): f32 {
  let sum: f32 = 0.0;
  let amp: f32 = 0.5;
  let freq: f32 = 1.0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    let n = pnoise2(x * freq, y * freq, period, seed + o * 733);
    n = 1.0 - Mathf.abs(n);
    sum += amp * n * n;
    amp *= 0.5;
    freq *= 2.0;
    period *= 2;
  }
  return sum;
}

// Periodic Voronoi: returns F1 and F2 of the nearest two feature points.
// Lattice wraps at `period`.
export function pvoronoi2(x: f32, y: f32, period: i32, seed: i32, jitter: f32): StaticArray<f32> {
  let ix = i32(Mathf.floor(x));
  let iy = i32(Mathf.floor(y));
  let f1: f32 = 8.0;
  let f2: f32 = 8.0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      let cx = wrapi(ix + ox, period);
      let cy = wrapi(iy + oy, period);
      let px = f32(ix + ox) + 0.5 + jitter * (hash2(cx, cy, seed) - 0.5);
      let py = f32(iy + oy) + 0.5 + jitter * (hash2(cx, cy, seed + 977) - 0.5);
      let dx = px - x;
      let dy = py - y;
      let d = dx * dx + dy * dy;
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  let out = new StaticArray<f32>(2);
  out[0] = Mathf.sqrt(f1);
  out[1] = Mathf.sqrt(f2);
  return out;
}
