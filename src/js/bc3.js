// BC3 (DXT5) block codec: 16 bytes per 4x4 block.
// First 8 bytes: two explicit alpha endpoints plus 16 3-bit alpha indices.
// Last 8 bytes: a BC1 color block always in 4-color mode.

import { encodeBC1Block, decodeBC1Block } from './bc1.js';

function alphaTable(a0, a1) {
  const table = new Uint8Array(8);
  table[0] = a0;
  table[1] = a1;
  if (a0 > a1) {
    for (let i = 1; i <= 6; i++) {
      table[i + 1] = (((7 - i) * a0 + i * a1) / 7) | 0;
    }
  } else {
    for (let i = 1; i <= 4; i++) {
      table[i + 1] = (((6 - i) * a0 + i * a1) / 6) | 0;
    }
    table[6] = 0;
    table[7] = 255;
  }
  return table;
}

// pixels: Uint8ClampedArray of 64 values (16 RGBA pixels).
export function encodeBC3Block(pixels) {
  let aMin = 255;
  let aMax = 0;
  for (let i = 3; i < 64; i += 4) {
    const a = pixels[i];
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
  }
  // Keep a0 > a1 so all 8 interpolated alphas are available.
  let a0 = aMax;
  let a1 = Math.min(aMin, a0 === 0 ? 0 : a0 - 1);
  if (a0 === a1 && a0 < 255) a0 = Math.min(255, a0 + 1);

  let table = alphaTable(a0, a1);
  const indices = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const a = pixels[i * 4 + 3];
    let best = 0;
    let bestDist = Infinity;
    for (let k = 0; k < 8; k++) {
      const d = a - table[k];
      const dist = d * d;
      if (dist < bestDist) {
        bestDist = dist;
        best = k;
      }
    }
    indices[i] = best;
  }

  const block = new Uint8Array(16);
  block[0] = a0;
  block[1] = a1;
  // 48 index bits packed into bytes 2..7, low bits first.
  let bitBuffer = 0;
  let bitsInBuffer = 0;
  let byteIndex = 2;
  for (let i = 0; i < 16; i++) {
    bitBuffer |= indices[i] << bitsInBuffer;
    bitsInBuffer += 3;
    while (bitsInBuffer >= 8 && byteIndex < 8) {
      block[byteIndex++] = bitBuffer & 0xff;
      bitBuffer >>>= 8;
      bitsInBuffer -= 8;
    }
  }
  const colorBlock = encodeBC1Block(pixels, true);
  block.set(colorBlock, 8);
  return block;
}

// Decode one BC3 block into 16 RGBA pixels (Uint8ClampedArray length 64).
export function decodeBC3Block(block) {
  const a0 = block[0];
  const a1 = block[1];
  const table = alphaTable(a0, a1);
  const out = decodeBC1Block(block.subarray(8), true);
  let bitBuffer = 0;
  let bitsInBuffer = 0;
  let byteIndex = 2;
  for (let i = 0; i < 16; i++) {
    while (bitsInBuffer < 3) {
      bitBuffer |= block[byteIndex++] << bitsInBuffer;
      bitsInBuffer += 8;
    }
    const index = bitBuffer & 0x7;
    bitBuffer >>>= 3;
    bitsInBuffer -= 3;
    out[i * 4 + 3] = table[index];
  }
  return out;
}
