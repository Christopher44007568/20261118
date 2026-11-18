// Scalar quantization primitives shared by the CPU tests and the WebGL app.
// All functions use round-to-nearest and clamp so attribute boundaries
// (u=0/1, normalized unit vectors, AABB endpoints) are preserved exactly.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// --- unsigned 16-bit normalized (UNORM16): range [0,1] -> [0,65535] ---
export function quantizeUnorm16(x) {
  return Math.round(clamp(x, 0, 1) * 65535);
}

export function dequantizeUnorm16(q) {
  return q / 65535;
}

// --- signed 16-bit normalized (SNORM16): range [-1,1] -> [-32767,32767] ---
// -32768 is a reserved encoding (GL spec), so quantize never emits it.
export function quantizeSnorm16(x) {
  return clamp(Math.round(clamp(x, -1, 1) * 32767), -32767, 32767);
}

export function dequantizeSnorm16(q) {
  return clamp(q, -32767, 32767) / 32767;
}

// --- signed 8-bit normalized (SNORM8): range [-1,1] -> [-127,127] ---
export function quantizeSnorm8(x) {
  return clamp(Math.round(clamp(x, -1, 1) * 127), -127, 127);
}

export function dequantizeSnorm8(q) {
  return clamp(q, -127, 127) / 127;
}

// --- 16-bit position quantization against an axis-aligned bounding box ---
// UNORM16 keeps every reconstructed point inside [min,max] (no AABB overshoot).
export function makeAabbQuantizer(aabb) {
  const range = [
    aabb.max[0] - aabb.min[0],
    aabb.max[1] - aabb.min[1],
    aabb.max[2] - aabb.min[2],
  ];
  return {
    min: aabb.min.slice(),
    range,
    quantize(p) {
      return [
        quantizeUnorm16(range[0] === 0 ? 0 : (p[0] - aabb.min[0]) / range[0]),
        quantizeUnorm16(range[1] === 0 ? 0 : (p[1] - aabb.min[1]) / range[1]),
        quantizeUnorm16(range[2] === 0 ? 0 : (p[2] - aabb.min[2]) / range[2]),
      ];
    },
    dequantize(q) {
      return [
        aabb.min[0] + dequantizeUnorm16(q[0]) * range[0],
        aabb.min[1] + dequantizeUnorm16(q[1]) * range[1],
        aabb.min[2] + dequantizeUnorm16(q[2]) * range[2],
      ];
    },
  };
}

// --- 16-bit UV (UNORM16). 0 -> 0 and 1 -> 65535 exactly, so UV seams
// whose duplicated vertices sit on the [0,1] boundary stay distinct. ---
export function quantizeUv(uv) {
  return [quantizeUnorm16(uv[0]), quantizeUnorm16(uv[1])];
}

export function dequantizeUv(q) {
  return [dequantizeUnorm16(q[0]), dequantizeUnorm16(q[1])];
}
