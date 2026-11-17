// BC1 (DXT1) block codec: 8 bytes per 4x4 block.
// All math follows the DXT spec integer interpolation so that CPU output
// matches hardware decoders sample-for-sample.

export function encodeRGB565(r, g, b) {
  const r5 = Math.min(31, Math.round((r * 31) / 255));
  const g6 = Math.min(63, Math.round((g * 63) / 255));
  const b5 = Math.min(31, Math.round((b * 31) / 255));
  return ((r5 << 11) | (g6 << 5) | b5) & 0xffff;
}

export function decodeRGB565(value) {
  const r5 = (value >> 11) & 0x1f;
  const g6 = (value >> 5) & 0x3f;
  const b5 = value & 0x1f;
  return [
    (r5 << 3) | (r5 >> 2),
    (g6 << 2) | (g6 >> 4),
    (b5 << 3) | (b5 >> 2),
  ];
}

function buildPalette(c0, c1, forceFourColor) {
  const p0 = decodeRGB565(c0);
  const p1 = decodeRGB565(c1);
  const palette = new Uint8Array(16);
  palette.set(p0, 0);
  palette.set(p1, 3);
  if (forceFourColor || c0 > c1) {
    palette[6] = (2 * p0[0] + p1[0]) / 3 | 0;
    palette[7] = (2 * p0[1] + p1[1]) / 3 | 0;
    palette[8] = (2 * p0[2] + p1[2]) / 3 | 0;
    palette[9] = (p0[0] + 2 * p1[0]) / 3 | 0;
    palette[10] = (p0[1] + 2 * p1[1]) / 3 | 0;
    palette[11] = (p0[2] + 2 * p1[2]) / 3 | 0;
  } else {
    // Punch-through alpha mode: color 2 is a 50% blend, color 3 is transparent.
    palette[6] = (p0[0] + p1[0]) / 2 | 0;
    palette[7] = (p0[1] + p1[1]) / 2 | 0;
    palette[8] = (p0[2] + p1[2]) / 2 | 0;
    palette[9] = 0;
    palette[10] = 0;
    palette[11] = 0;
  }
  return palette;
}

// pixels: Uint8ClampedArray of length 64 (16 RGBA pixels, row-major 4x4).
// forceFourColor: BC3 embeds a BC1 color block that never uses punch-through.
export function encodeBC1Block(pixels, forceFourColor = false) {
  let rMin = 255, gMin = 255, bMin = 255;
  let rMax = 0, gMax = 0, bMax = 0;
  for (let i = 0; i < 16; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    if (r < rMin) rMin = r;
    if (g < gMin) gMin = g;
    if (b < bMin) bMin = b;
    if (r > rMax) rMax = r;
    if (g > gMax) gMax = g;
    if (b > bMax) bMax = b;
  }
  const spanR = rMax - rMin;
  const spanG = gMax - gMin;
  const spanB = bMax - bMin;
  const axis = spanR >= spanG && spanR >= spanB ? 0 : spanG >= spanB ? 1 : 2;

  // Partition around the midpoint of the dominant axis, then average each
  // group for more stable endpoints than raw box corners.
  let lo = [0, 0, 0], hi = [0, 0, 0];
  let loCount = 0, hiCount = 0;
  const mid = ([rMin, gMin, bMin][axis] + [rMax, gMax, bMax][axis]) / 2;
  for (let i = 0; i < 16; i++) {
    const px = [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]];
    const group = px[axis] < mid ? 0 : 1;
    if (group === 0) {
      lo[0] += px[0]; lo[1] += px[1]; lo[2] += px[2]; loCount++;
    } else {
      hi[0] += px[0]; hi[1] += px[1]; hi[2] += px[2]; hiCount++;
    }
  }
  lo = lo.map((v) => v / (loCount || 1) | 0);
  hi = hi.map((v) => v / (hiCount || 1) | 0);

  let c0 = encodeRGB565(hi[0], hi[1], hi[2]);
  let c1 = encodeRGB565(lo[0], lo[1], lo[2]);
  if (c0 <= c1) {
    c1 = Math.max(0, c0 - 1);
  }

  const palette = buildPalette(c0, c1, forceFourColor);
  const block = new Uint8Array(8);
  block[0] = c0 & 0xff;
  block[1] = (c0 >> 8) & 0xff;
  block[2] = c1 & 0xff;
  block[3] = (c1 >> 8) & 0xff;

  for (let i = 0; i < 16; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    let best = 0;
    let bestDist = Infinity;
    for (let k = 0; k < 4; k++) {
      const dr = r - palette[k * 3];
      const dg = g - palette[k * 3 + 1];
      const db = b - palette[k * 3 + 2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = k;
      }
    }
    block[4 + (i >> 2)] |= best << ((i & 3) * 2);
  }
  return block;
}

// Decode one BC1 block into 16 RGBA pixels (Uint8ClampedArray length 64).
export function decodeBC1Block(block, forceFourColor = false) {
  const c0 = block[0] | (block[1] << 8);
  const c1 = block[2] | (block[3] << 8);
  const palette = buildPalette(c0, c1, forceFourColor);
  const transparent = !forceFourColor && c0 <= c1;
  const out = new Uint8ClampedArray(64);
  for (let i = 0; i < 16; i++) {
    const index = (block[4 + (i >> 2)] >> ((i & 3) * 2)) & 0x3;
    out[i * 4] = palette[index * 3];
    out[i * 4 + 1] = palette[index * 3 + 1];
    out[i * 4 + 2] = palette[index * 3 + 2];
    out[i * 4 + 3] = transparent && index === 3 ? 0 : 255;
  }
  return out;
}
