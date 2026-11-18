const clamp01 = (value) => Math.min(1, Math.max(0, value));

export const TEXTURE_SPECS = Object.freeze([
  {
    id: "nova",
    code: "NX-01",
    sector: "ORION",
    name: "NOVA BLOOM",
    seed: 1.7,
    deep: [8, 10, 25],
    accent: [238, 93, 255],
    secondary: [68, 228, 255],
    targetAverage: [24, 27, 45]
  },
  {
    id: "verdant",
    code: "VR-08",
    sector: "HELIX",
    name: "VERDANT SCAN",
    seed: 4.2,
    deep: [6, 21, 20],
    accent: [171, 255, 93],
    secondary: [38, 232, 172],
    targetAverage: [18, 36, 32]
  },
  {
    id: "solar",
    code: "SL-12",
    sector: "KEPLER",
    name: "SOLAR RELAY",
    seed: 7.9,
    deep: [30, 13, 15],
    accent: [255, 162, 61],
    secondary: [255, 74, 113],
    targetAverage: [43, 23, 25]
  },
  {
    id: "cryo",
    code: "CR-03",
    sector: "NEREID",
    name: "CRYO FIELD",
    seed: 2.4,
    deep: [6, 17, 32],
    accent: [88, 205, 255],
    secondary: [200, 247, 255],
    targetAverage: [18, 34, 50]
  },
  {
    id: "vanta",
    code: "VT-19",
    sector: "UMBRA",
    name: "VANTA CIRCUIT",
    seed: 9.1,
    deep: [20, 10, 31],
    accent: [190, 116, 255],
    secondary: [255, 94, 169],
    targetAverage: [32, 19, 43]
  },
  {
    id: "ember",
    code: "EM-07",
    sector: "FORGE",
    name: "EMBER DUST",
    seed: 5.3,
    deep: [27, 10, 8],
    accent: [255, 112, 49],
    secondary: [255, 211, 92],
    targetAverage: [39, 21, 18]
  },
  {
    id: "pearl",
    code: "PR-11",
    sector: "TETHYS",
    name: "PEARL VECTOR",
    seed: 3.6,
    deep: [6, 24, 28],
    accent: [111, 255, 231],
    secondary: [113, 158, 255],
    targetAverage: [18, 39, 44]
  },
  {
    id: "signal",
    code: "SG-04",
    sector: "VESPER",
    name: "ROSE SIGNAL",
    seed: 8.4,
    deep: [28, 9, 22],
    accent: [255, 91, 130],
    secondary: [117, 201, 255],
    targetAverage: [39, 18, 31]
  }
]);

function abortError(message = "texture request cancelled") {
  return new DOMException(message, "AbortError");
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function smoothstep(edge0, edge1, value) {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
}

function normalizeMean(data, target) {
  const length = data.length;
  for (let pass = 0; pass < 2; pass += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let index = 0; index < length; index += 4) {
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
    }
    const pixels = length / 4;
    const delta = [
      target[0] - r / pixels,
      target[1] - g / pixels,
      target[2] - b / pixels
    ];
    for (let index = 0; index < length; index += 4) {
      data[index] = Math.max(0, Math.min(255, data[index] + delta[0]));
      data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + delta[1]));
      data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + delta[2]));
    }
  }
}

function renderPixels(spec, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { alpha: false });
  const image = context.createImageData(size, size);
  const data = image.data;
  const deep = spec.deep;
  const accent = spec.accent;
  const secondary = spec.secondary;
  const seed = spec.seed;

  for (let y = 0; y < size; y += 1) {
    const v = y / Math.max(1, size - 1);
    for (let x = 0; x < size; x += 1) {
      const u = x / Math.max(1, size - 1);
      const index = (y * size + x) * 4;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const flow = 0.5 + 0.5 * Math.sin((u * 4.3 + v * 2.6 + seed) * Math.PI * 2);
      const wave = 0.5 + 0.5 * Math.sin((u * 9.1 - v * 7.2 + seed * 0.6) * Math.PI * 2);
      const grain = Math.sin(u * 71.3 + v * 53.9 + seed * 13.1) * 0.5 + 0.5;
      const haloA = Math.exp(-(((u - 0.64) ** 2 + (v - 0.34) ** 2) * 23));
      const haloB = Math.exp(-(((u - 0.31) ** 2 + (v - 0.7) ** 2) * 31));
      const core = Math.exp(-Math.max(0, radius - 0.095) * 54);
      const ring = Math.exp(-(((radius - 0.31) * 22) ** 2));
      const filaments = (0.5 + 0.5 * Math.cos(radius * 87 - angle * 3 - seed * 2)) ** 16;
      const grid = (0.5 + 0.5 * Math.cos((u * 8 + v * 3 + seed) * Math.PI * 2)) ** 24;
      const vignette = 1 - smoothstep(0.17, 0.72, radius) * 0.82;
      const shade = 0.44 + v * 0.7 + flow * 0.08;
      const structure = clamp01(flow * 0.14 + wave * 0.08 + ring * 0.6 + grid * 0.2);

      let red = deep[0] * shade + accent[0] * haloA * 0.42 + secondary[0] * haloB * 0.22;
      let green = deep[1] * shade + accent[1] * haloA * 0.42 + secondary[1] * haloB * 0.22;
      let blue = deep[2] * shade + accent[2] * haloA * 0.42 + secondary[2] * haloB * 0.22;
      red += accent[0] * structure * 0.15 + secondary[0] * filaments * 0.18;
      green += accent[1] * structure * 0.15 + secondary[1] * filaments * 0.18;
      blue += accent[2] * structure * 0.15 + secondary[2] * filaments * 0.18;
      red += accent[0] * core * 0.62 + 255 * core ** 5 * 0.11;
      green += accent[1] * core * 0.62 + 255 * core ** 5 * 0.11;
      blue += accent[2] * core * 0.62 + 255 * core ** 5 * 0.11;
      const grainOffset = (grain - 0.5) * 5.2;

      data[index] = (red + grainOffset) * vignette;
      data[index + 1] = (green + grainOffset) * vignette;
      data[index + 2] = (blue + grainOffset) * vignette;
      data[index + 3] = 255;
    }
  }

  normalizeMean(data, spec.targetAverage);
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  for (let index = 0; index < data.length; index += 4) {
    totalR += data[index];
    totalG += data[index + 1];
    totalB += data[index + 2];
  }
  const pixels = size * size;
  context.putImageData(image, 0, 0);
  return {
    canvas,
    average: [totalR / pixels, totalG / pixels, totalB / pixels],
    width: size,
    height: size,
    bytes: size * size * 4
  };
}

export function createTextureLoader({ isOnline = () => true, latencyScale = 1 } = {}) {
  const cache = new Map();
  const baseLatency = [110, 230, 370, 540];

  return async ({ asset, level, definition, signal }) => {
    const jitter = 0.72 + ((asset.meta.seed || 1) * 0.13 + level * 0.07) % 0.55;
    await delay(baseLatency[level] * latencyScale * jitter, signal);
    if (!isOnline()) throw new Error("NETWORK_OFFLINE");
    if (signal?.aborted) throw abortError();

    const key = `${asset.id}:${level}`;
    if (!cache.has(key)) cache.set(key, renderPixels(asset.meta.spec, definition.size));
    return cache.get(key);
  };
}
