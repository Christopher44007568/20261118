// Error metrics between the original RGBA image and the decoded image.

import { blockDimensions } from './codec.js';

// Returns global RMSE (per channel and RGB mean), PSNR and max error.
export function globalMetrics(original, decoded, width, height) {
  let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
  let maxError = 0;
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i++) {
    const dr = original[i * 4] - decoded[i * 4];
    const dg = original[i * 4 + 1] - decoded[i * 4 + 1];
    const db = original[i * 4 + 2] - decoded[i * 4 + 2];
    const da = original[i * 4 + 3] - decoded[i * 4 + 3];
    sumR += dr * dr;
    sumG += dg * dg;
    sumB += db * db;
    sumA += da * da;
    maxError = Math.max(maxError, Math.abs(dr), Math.abs(dg), Math.abs(db), Math.abs(da));
  }
  const rmseR = Math.sqrt(sumR / pixelCount);
  const rmseG = Math.sqrt(sumG / pixelCount);
  const rmseB = Math.sqrt(sumB / pixelCount);
  const rmseA = Math.sqrt(sumA / pixelCount);
  const rmseRgb = Math.sqrt((sumR + sumG + sumB) / (pixelCount * 3));
  const psnr =
    rmseRgb === 0 ? Infinity : 10 * Math.log10((255 * 255) / (rmseRgb * rmseRgb));
  return {
    rmse: { r: rmseR, g: rmseG, b: rmseB, a: rmseA, rgb: rmseRgb },
    psnr,
    maxError,
  };
}

// Per-block mean RGB error (only real texels inside the image are counted),
// plus each block's mean compressed color. Returned arrays are blocksX*blocksY.
export function blockMetrics(original, decoded, width, height, format) {
  const { blocksX, blocksY } = blockDimensions(width, height);
  const errors = new Float32Array(blocksX * blocksY);
  const meanColors = new Uint8ClampedArray(blocksX * blocksY * 4);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      let sumError = 0;
      let count = 0;
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      for (let y = 0; y < 4; y++) {
        const sy = by * 4 + y;
        if (sy >= height) break;
        for (let x = 0; x < 4; x++) {
          const sx = bx * 4 + x;
          if (sx >= width) continue;
          const idx = (sy * width + sx) * 4;
          const dr = original[idx] - decoded[idx];
          const dg = original[idx + 1] - decoded[idx + 1];
          const db = original[idx + 2] - decoded[idx + 2];
          sumError += Math.sqrt(dr * dr + dg * dg + db * db);
          rSum += decoded[idx];
          gSum += decoded[idx + 1];
          bSum += decoded[idx + 2];
          aSum += decoded[idx + 3];
          count++;
        }
      }
      const blockIndex = by * blocksX + bx;
      errors[blockIndex] = sumError / count;
      meanColors[blockIndex * 4] = rSum / count;
      meanColors[blockIndex * 4 + 1] = gSum / count;
      meanColors[blockIndex * 4 + 2] = bSum / count;
      meanColors[blockIndex * 4 + 3] = aSum / count;
    }
  }
  return {
    blocksX,
    blocksY,
    errors,
    meanColors,
    maxBlockError: errors.reduce((m, v) => Math.max(m, v), 0),
    format,
  };
}

// Colorize a scalar error value into a blue -> red heat map.
export function heatColor(value, maxValue) {
  const t = maxValue === 0 ? 0 : Math.min(1, value / maxValue);
  const r = Math.round(255 * Math.min(1, t * 2));
  const g = Math.round(255 * Math.min(1, 2 - t * 2));
  const b = Math.round(255 * (1 - t));
  return [r, g, b];
}
