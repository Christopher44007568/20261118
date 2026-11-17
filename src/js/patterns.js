// Procedural test patterns, all returned as RGBA Uint8ClampedArray.
// Default dimensions are deliberately not multiples of 4 so edge blocks
// (right column and bottom row) are exercised on every run.

export const DEFAULT_WIDTH = 30;
export const DEFAULT_HEIGHT = 22;

// Deterministic PRNG so noise runs are reproducible.
function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function emptyImage(width, height) {
  return new Uint8ClampedArray(width * height * 4);
}

export function makeGradient(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const data = emptyImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = Math.round((x / (width - 1)) * 255);
      data[idx + 1] = Math.round((y / (height - 1)) * 255);
      data[idx + 2] = Math.round((1 - x / (width - 1)) * 128 + 64);
      data[idx + 3] = 255;
    }
  }
  return { data, width, height, name: 'gradient', label: '平滑渐变' };
}

export function makeHardEdge(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const data = emptyImage(width, height);
  const quadrants = [
    [220, 40, 40],
    [40, 200, 80],
    [50, 90, 230],
    [235, 220, 60],
  ];
  const midX = width / 2;
  const midY = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const q = (y >= midY ? 2 : 0) + (x >= midX ? 1 : 0);
      let color = quadrants[q];
      // A sharp diagonal stripe cuts through the quadrants as well.
      if (Math.abs(x - y) <= 1) color = [255, 255, 255];
      data[idx] = color[0];
      data[idx + 1] = color[1];
      data[idx + 2] = color[2];
      // A vertical alpha ramp on the right half exercises BC3 alpha.
      data[idx + 3] = x < midX ? 255 : Math.round(80 + (x - midX) * (175 / midX));
    }
  }
  return { data, width, height, name: 'hard-edge', label: '硬边图案' };
}

export function makeNoise(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, seed = 20261118) {
  const data = emptyImage(width, height);
  const random = mulberry32(seed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = Math.round(random() * 255);
      data[idx + 1] = Math.round(random() * 255);
      data[idx + 2] = Math.round(random() * 255);
      data[idx + 3] = Math.round(random() * 255);
    }
  }
  return { data, width, height, name: 'noise', label: '噪声图案' };
}

export function makePattern(name, width, height) {
  if (name === 'gradient') return makeGradient(width, height);
  if (name === 'hard-edge') return makeHardEdge(width, height);
  return makeNoise(width, height);
}

// Decode an uploaded image file into an RGBA buffer at its native size.
export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve({
        data: imageData.data,
        width: canvas.width,
        height: canvas.height,
        name: 'file',
        label: file.name,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    image.src = url;
  });
}
