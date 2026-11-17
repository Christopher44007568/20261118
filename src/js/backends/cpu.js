// CPU reference backend. Always available; doubles as the ground-truth
// decoder for validating GPU output and as the fallback when the platform
// lacks native BC support.

import { decodeImage } from '../codec.js';

export function isAvailable() {
  return true;
}

export function capabilities() {
  return { available: true, nativeBC: false, formats: [], renderer: 'JavaScript reference decoder' };
}

export function decodeCPU(blocks, width, height, format) {
  const start = performance.now();
  const data = decodeImage(blocks, width, height, format);
  const elapsedMs = performance.now() - start;
  return {
    data,
    width,
    height,
    elapsedMs,
    mode: 'cpu-reference',
    uploadBytes: 0,
    compressedBytes: blocks.byteLength,
    backend: 'CPU',
  };
}
