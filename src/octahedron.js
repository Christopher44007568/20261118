// Octahedron unit-vector encoding.
//
// oct16: two signed 8-bit components (canonical "oct16" / ETC variant).
// oct32: two signed 16-bit components, kept for an error/size comparison.
//
// The fold/wrap math mirrors the GLSL decode in src/shaders.js one-to-one so
// the CPU error harness measures exactly what the GPU reconstructs.

import {
  quantizeSnorm8, dequantizeSnorm8,
  quantizeSnorm16, dequantizeSnorm16,
} from './quant.js';

// Canonical octahedral fold (Meyer et al. 2010 / glTF oct16 spec). In the
// fold, each output keeps the sign of the *other* input component, so this
// helper takes both the value to wrap and the component that supplies sign.
function octFold(value, signSource) {
  return (1.0 - Math.abs(value)) * (signSource >= 0 ? 1.0 : -1.0);
}

// Encode a unit vector n into two octahedral projection components in [-1,1].
export function octEncode(n) {
  const l1 = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]);
  const inv = 1.0 / l1;
  let x = n[0] * inv;
  let y = n[1] * inv;
  // Snap axis poles: when one component dominates, the other two are only
  // floating-point dust and must not (via a spurious sign) trigger the fold.
  const dominant =
    Math.abs(n[0]) > (1 - 1e-9) * l1 ? 0 :
    Math.abs(n[1]) > (1 - 1e-9) * l1 ? 1 :
    Math.abs(n[2]) > (1 - 1e-9) * l1 ? 2 : -1;
  if (dominant === 0) {
    return [n[0] >= 0 ? 1 : -1, 0];
  }
  if (dominant === 1) {
    return [0, n[1] >= 0 ? 1 : -1];
  }
  if (dominant === 2) {
    return n[2] >= 0 ? [0, 0] : [1, 1];
  }
  // Fold only for genuine lower-hemisphere vectors. Equator points can carry
  // a tiny signed-z round-off; mirror the decode-side dust tolerance.
  const zNorm = n[2] * inv;
  if (zNorm < -1e-7) {
    const oldX = x;
    const oldY = y;
    x = octFold(oldY, oldX);
    y = octFold(oldX, oldY);
  }
  return [x, y];
}

// Decode octahedral projection components back to a (non-normalized) vector.
export function octDecodeRaw(x, y) {
  // Fold decision and sign are taken from the pre-wrap z. The epsilon matches
  // octEncode so equator dust (|x|+|y| rounding to 1) is treated consistently
  // on both sides; genuine folds exceed the oct16 quantization step.
  const zRaw = 1.0 - Math.abs(x) - Math.abs(y);
  let vx = x;
  let vy = y;
  if (zRaw < -1e-7) {
    vx = octFold(y, x);
    vy = octFold(x, y);
  }
  const len = Math.hypot(vx, vy, zRaw);
  return [vx / len, vy / len, zRaw / len];
}

export function oct16Encode(n) {
  const [x, y] = octEncode(n);
  return [quantizeSnorm8(x), quantizeSnorm8(y)];
}

export function oct16Decode(q) {
  return octDecodeRaw(dequantizeSnorm8(q[0]), dequantizeSnorm8(q[1]));
}

export function oct32Encode(n) {
  const [x, y] = octEncode(n);
  return [quantizeSnorm16(x), quantizeSnorm16(y)];
}

export function oct32Decode(q) {
  return octDecodeRaw(dequantizeSnorm16(q[0]), dequantizeSnorm16(q[1]));
}
