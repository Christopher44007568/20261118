// Full-image BC encode/decode with correct edge-block handling.
// Images whose width/height is not a multiple of 4 are padded by clamping
// (edge replication), matching how hardware treats the padded texels.

import { encodeBC1Block, decodeBC1Block } from './bc1.js';
import { encodeBC3Block, decodeBC3Block } from './bc3.js';

export const FORMATS = {
  BC1: { bytesPerBlock: 8, glEnum: 0x83f0, wgpu: 'bc1-rgba-unorm', label: 'BC1 (DXT1, RGB)' },
  BC3: { bytesPerBlock: 16, glEnum: 0x83f2, wgpu: 'bc3-rgba-unorm', label: 'BC3 (DXT5, RGBA)' },
};

export function blockDimensions(width, height) {
  return {
    blocksX: Math.ceil(width / 4),
    blocksY: Math.ceil(height / 4),
    paddedWidth: Math.ceil(width / 4) * 4,
    paddedHeight: Math.ceil(height / 4) * 4,
  };
}

function encodeBlock(format, pixels) {
  return format === 'BC1' ? encodeBC1Block(pixels) : encodeBC3Block(pixels);
}

function decodeBlock(format, block) {
  return format === 'BC1' ? decodeBC1Block(block) : decodeBC3Block(block);
}

// data: RGBA Uint8ClampedArray of width*height*4.
// Returns a Uint8Array holding tightly packed block data.
export function encodeImage(data, width, height, format) {
  const { blocksX, blocksY } = blockDimensions(width, height);
  const bytes = FORMATS[format].bytesPerBlock;
  const output = new Uint8Array(blocksX * blocksY * bytes);
  const blockPixels = new Uint8ClampedArray(64);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          // Clamp coordinates so edge blocks replicate the border texel.
          const sx = Math.min(width - 1, bx * 4 + x);
          const sy = Math.min(height - 1, by * 4 + y);
          const src = (sy * width + sx) * 4;
          const dst = (y * 4 + x) * 4;
          blockPixels[dst] = data[src];
          blockPixels[dst + 1] = data[src + 1];
          blockPixels[dst + 2] = data[src + 2];
          blockPixels[dst + 3] = data[src + 3];
        }
      }
      const encoded = encodeBlock(format, blockPixels);
      const offset = (by * blocksX + bx) * bytes;
      output.set(encoded, offset);
    }
  }
  return output;
}

// Decode packed block data back into an RGBA buffer of the ORIGINAL
// dimensions; padded texels outside the image are discarded.
export function decodeImage(blocks, width, height, format) {
  const { blocksX, blocksY } = blockDimensions(width, height);
  const bytes = FORMATS[format].bytesPerBlock;
  const output = new Uint8ClampedArray(width * height * 4);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const offset = (by * blocksX + bx) * bytes;
      const block = blocks.subarray(offset, offset + bytes);
      const decoded = decodeBlock(format, block);
      for (let y = 0; y < 4; y++) {
        const sy = by * 4 + y;
        if (sy >= height) break;
        for (let x = 0; x < 4; x++) {
          const sx = bx * 4 + x;
          if (sx >= width) continue;
          const src = (y * 4 + x) * 4;
          const dst = (sy * width + sx) * 4;
          output[dst] = decoded[src];
          output[dst + 1] = decoded[src + 1];
          output[dst + 2] = decoded[src + 2];
          output[dst + 3] = decoded[src + 3];
        }
      }
    }
  }
  return output;
}

export function compressedByteSize(width, height, format) {
  const { blocksX, blocksY } = blockDimensions(width, height);
  return blocksX * blocksY * FORMATS[format].bytesPerBlock;
}
