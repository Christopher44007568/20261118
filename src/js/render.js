// Canvas rendering helpers: full images, per-block mean colors and the
// per-block error heat map with block-grid and edge-block overlays.

import { blockDimensions } from './codec.js';
import { heatColor } from './metrics.js';

export function drawImage(canvas, image) {
  const { data, width, height } = image;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(data);
  ctx.putImageData(imageData, 0, 0);
}

// Render the compressed result as one solid cell per 4x4 block so the
// coarse block structure introduced by compression is clearly visible.
export function drawBlockColors(canvas, blockInfo) {
  const { blocksX, blocksY, meanColors } = blockInfo;
  const cell = 14;
  canvas.width = blocksX * cell;
  canvas.height = blocksY * cell;
  const ctx = canvas.getContext('2d');
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const index = by * blocksX + bx;
      ctx.fillStyle = `rgba(${meanColors[index * 4]},${meanColors[index * 4 + 1]},${meanColors[index * 4 + 2]},${(meanColors[index * 4 + 3] / 255).toFixed(3)})`;
      ctx.fillRect(bx * cell, by * cell, cell - 1, cell - 1);
    }
  }
  outlineEdgeBlocks(ctx, blocksX, blocksY, cell, blockInfo);
}

export function drawHeatMap(canvas, blockInfo) {
  const { blocksX, blocksY, errors, maxBlockError } = blockInfo;
  const cell = 14;
  canvas.width = blocksX * cell;
  canvas.height = blocksY * cell + 28;
  const ctx = canvas.getContext('2d');
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const index = by * blocksX + bx;
      const [r, g, b] = heatColor(errors[index], maxBlockError);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(bx * cell, by * cell, cell - 1, cell - 1);
      if (cell >= 12) {
        ctx.fillStyle = maxBlockError > 0 && errors[index] / maxBlockError > 0.55 ? '#fff' : '#222';
        ctx.font = '8px monospace';
        ctx.fillText(errors[index].toFixed(0), bx * cell + 1, by * cell + cell - 3);
      }
    }
  }
  outlineEdgeBlocks(ctx, blocksX, blocksY, cell, blockInfo);
  drawLegend(ctx, blocksX * cell);
}

function outlineEdgeBlocks(ctx, blocksX, blocksY, cell, blockInfo) {
  // Edge blocks only exist when the image dimension is not a multiple of 4.
  const raggedRight = blockInfo.imageWidth ? blockInfo.imageWidth % 4 !== 0 : false;
  const raggedBottom = blockInfo.imageHeight ? blockInfo.imageHeight % 4 !== 0 : false;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1;
  if (raggedRight) {
    ctx.strokeRect((blocksX - 1) * cell + 0.5, 0, cell - 1, blocksY * cell - 1);
  }
  if (raggedBottom) {
    ctx.strokeRect(0, (blocksY - 1) * cell + 0.5, blocksX * cell - 1, cell - 1);
  }
}

function drawLegend(ctx, width) {
  const y = ctx.canvas.height - 12;
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, 'rgb(0,255,255)');
  gradient.addColorStop(0.5, 'rgb(255,255,0)');
  gradient.addColorStop(1, 'rgb(255,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, y, width, 8);
  ctx.fillStyle = '#111';
  ctx.font = '9px monospace';
  ctx.fillText('低误差', 0, y - 3);
  ctx.fillText('高误差', width - 42, y - 3);
}

// Pixel-level difference map (amplified) to complement the block heat map.
export function drawDifference(canvas, original, decoded) {
  const { width, height } = original;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const dr = Math.abs(original.data[i * 4] - decoded.data[i * 4]);
    const dg = Math.abs(original.data[i * 4 + 1] - decoded.data[i * 4 + 1]);
    const db = Math.abs(original.data[i * 4 + 2] - decoded.data[i * 4 + 2]);
    const value = Math.max(dr, dg, db);
    out.data[i * 4] = Math.min(255, value * 3);
    out.data[i * 4 + 1] = Math.min(255, value);
    out.data[i * 4 + 2] = 255 - Math.min(255, value * 3);
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

export function attachImageSize(blockInfo, width, height) {
  blockInfo.imageWidth = width;
  blockInfo.imageHeight = height;
  const dims = blockDimensions(width, height);
  blockInfo.ragged = width % 4 !== 0 || height % 4 !== 0;
  blockInfo.paddedWidth = dims.paddedWidth;
  blockInfo.paddedHeight = dims.paddedHeight;
  return blockInfo;
}
