const EPSILON = 1e-6;

function smoothMin(a, b, radius) {
  const h = Math.max(radius - Math.abs(a - b), 0) / radius;
  return Math.min(a, b) - h * h * radius * 0.25;
}

function roundedBox(x, y, z, halfSize, radius) {
  const qx = Math.abs(x) - halfSize;
  const qy = Math.abs(y) - halfSize * 0.78;
  const qz = Math.abs(z) - halfSize * 1.12;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  const inside = Math.min(Math.max(qx, qy, qz), 0);
  return outside + inside - radius;
}

export const FIELDS = [
  {
    id: "union",
    label: "平滑融合",
    english: "Smooth union",
    description: "两个球体的多项式平滑并集，颈部连续性最适合观察四边形走向。",
    equation: "f = −smin(d₁, d₂, 0.22)",
    accent: "#77e8ff",
    smoothing: 0.58,
    resolution: 56,
    threshold: { min: -0.1, max: 0.12, step: 0.002, value: 0 },
    evaluate(x, y, z) {
      const left = Math.hypot(x + 0.22, y, z) - 0.37;
      const right = Math.hypot(x - 0.22, y, z) - 0.37;
      return -smoothMin(left, right, 0.22);
    },
  },
  {
    id: "sharp",
    label: "锐利场",
    english: "Sharp field",
    description: "圆角盒体的曲率变化集中在棱边，自动采用更小的平滑系数保护尖角。",
    equation: "f = −sdf(rounded box)",
    accent: "#ffc56e",
    smoothing: 0.1,
    resolution: 56,
    threshold: { min: -0.07, max: 0.07, step: 0.001, value: 0 },
    evaluate(x, y, z) {
      const box = roundedBox(x, y, z, 0.34, 0.045);
      const cut = Math.abs(y + 0.08) - 0.31;
      return -Math.max(box, cut);
    },
  },
  {
    id: "torus",
    label: "环形拓扑",
    english: "Torus",
    description: "连续亏格为 1 的环形场，用于检查四边形网格跨阈值时的拓扑稳定性。",
    equation: "f = −(‖(‖(x,z)‖−R, y)‖−r)",
    accent: "#b6ff9e",
    smoothing: 0.42,
    resolution: 56,
    threshold: { min: -0.1, max: 0.1, step: 0.002, value: 0 },
    evaluate(x, y, z) {
      const tube = Math.hypot(Math.hypot(x, z) - 0.38, y) - 0.145;
      return -tube;
    },
  },
  {
    id: "sphere",
    label: "解析球体",
    english: "Analytic sphere",
    description: "解析距离场作为稳定基线，便于核对顶点数、面数和法线方向。",
    equation: "f = 0.54 − ‖p‖",
    accent: "#d8a7ff",
    smoothing: 0.38,
    resolution: 56,
    threshold: { min: -0.1, max: 0.12, step: 0.002, value: 0 },
    evaluate(x, y, z) {
      return 0.54 - Math.hypot(x, y, z);
    },
  },
];

export function getField(id) {
  return FIELDS.find((field) => field.id === id) ?? FIELDS[0];
}

export function sampleGradient(field, x, y, z, h = 0.0025) {
  const gx =
    (field.evaluate(x + h, y, z) - field.evaluate(x - h, y, z)) / (2 * h);
  const gy =
    (field.evaluate(x, y + h, z) - field.evaluate(x, y - h, z)) / (2 * h);
  const gz =
    (field.evaluate(x, y, z + h) - field.evaluate(x, y, z - h)) / (2 * h);
  const length = Math.hypot(gx, gy, gz);
  if (length < EPSILON || !Number.isFinite(length)) {
    return [0, 0, 0];
  }
  return [gx / length, gy / length, gz / length];
}

export function surfaceNormal(field, x, y, z, h = 0.0025) {
  const gradient = sampleGradient(field, x, y, z, h);
  return [-gradient[0], -gradient[1], -gradient[2]];
}
