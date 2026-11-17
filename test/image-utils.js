// Pixel-level analysis helpers operating on readPixels() output.
// readPixels returns bottom-up rows; helpers flip to top-down for sane math.

export function flipY(frame) {
  const { width: w, height: h, pixels } = frame;
  const out = new Uint8Array(pixels.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * row;
    out.set(pixels.subarray(src, src + row), y * row);
  }
  return { width: w, height: h, pixels: out };
}

export function px(frame, x, y) {
  const i = (y * frame.width + x) * 4;
  return [
    frame.pixels[i], frame.pixels[i + 1],
    frame.pixels[i + 2], frame.pixels[i + 3],
  ];
}

export function meanDiff(a, b, mask) {
  const n = a.pixels.length / 4;
  let sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (mask && !mask(i)) continue;
    const o = i * 4;
    sum += (Math.abs(a.pixels[o] - b.pixels[o])
      + Math.abs(a.pixels[o + 1] - b.pixels[o + 1])
      + Math.abs(a.pixels[o + 2] - b.pixels[o + 2])) / 3;
    count++;
  }
  return count ? sum / count : 0;
}

export function diffHistogram(a, b) {
  const n = a.pixels.length / 4;
  const hist = new Array(8).fill(0);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = (Math.abs(a.pixels[o] - b.pixels[o])
      + Math.abs(a.pixels[o + 1] - b.pixels[o + 1])
      + Math.abs(a.pixels[o + 2] - b.pixels[o + 2])) / 3;
    hist[Math.min(7, Math.floor(d / 8))]++;
  }
  return hist;
}

export function countNonBackground(frame, bg = [5, 6, 10], tol = 6) {
  const n = frame.pixels.length / 4;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (Math.abs(frame.pixels[o] - bg[0]) > tol
      || Math.abs(frame.pixels[o + 1] - bg[1]) > tol
      || Math.abs(frame.pixels[o + 2] - bg[2]) > tol) count++;
  }
  return count;
}

// Save a frame as PPM (P6) so screenshots exist without extra dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';

export function savePPM(frame, path) {
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  const { width: w, height: h, pixels } = frame;
  const header = Buffer.from(`P6\n${w} ${h}\n255\n`);
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) {
    rgb[j] = pixels[i]; rgb[j + 1] = pixels[i + 1]; rgb[j + 2] = pixels[i + 2];
  }
  writeFileSync(path, Buffer.concat([header, rgb]));
}
