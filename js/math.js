/*
 * 深度精度数学模块：透视投影矩阵、标准 Z / 反向 Z 的眼空间->存储深度映射、
 * 24 位定点与 32 位浮点的量化规则及量化步长（LSB）。
 * 同时可在浏览器直接加载，也可在 Node 中 require 用于自动化测试。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.DepthMath = api;
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  const UNORM24_LEVELS = 0xffffff; // 2^24 - 1
  const F32_MIN_SUBNORMAL = Math.pow(2, -149);

  // 列主序透视投影矩阵。d = 眼空间正深度（相机位于原点，看向 -Z）。
  function perspective(fovyRad, aspect, near, far, reverse) {
    const f = 1 / Math.tan(fovyRad / 2);
    const nf = 1 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = reverse ? (far + near) * nf : (far + near) * nf;
    out[14] = reverse ? 2 * far * near * nf : 2 * far * near * nf;
    out[11] = -1;
    out[15] = 0;
    if (reverse) {
      // 反向 Z：眼空间 d=near 映射到 1，d=far 映射到 0
      out[10] = -near / (far - near);
      out[14] = (far * near) / (far - near);
    } else {
      // 标准 Z（裁剪空间 z 范围 [0, w]，WebGL 透视除法后落在 [0,1]）
      out[10] = -(far + near) / (far - near);
      out[14] = -(2 * far * near) / (far - near);
    }
    return out;
  }

  // 眼空间正深度 d -> 理想（未量化）存储深度 s
  function storedDepth(d, near, far, reverse) {
    if (reverse) {
      return (near * (far - d)) / (d * (far - near));
    }
    return (far * (d - near)) / (d * (far - near));
  }

  function quantize(s, mode) {
    if (mode === "depth24") {
      const level = Math.round(s * UNORM24_LEVELS);
      return Math.min(UNORM24_LEVELS, Math.max(0, level)) / UNORM24_LEVELS;
    }
    // depth32f 与 reverse-z 都使用 32 位浮点深度缓冲
    return Math.fround(s);
  }

  function f32Ulp(x) {
    if (!Number.isFinite(x) || x === 0) return F32_MIN_SUBNORMAL;
    const ax = Math.abs(x);
    const exponent = Math.floor(Math.log2(ax));
    if (exponent < -126) return F32_MIN_SUBNORMAL;
    return Math.pow(2, exponent - 23);
  }

  // 指定眼空间深度处，存储深度的最小可表示步长
  function storageLSB(d, near, far, mode, reverse) {
    const s = storedDepth(d, near, far, reverse);
    if (mode === "depth24") return 1 / UNORM24_LEVELS;
    return f32Ulp(s);
  }

  // |ds/dd|，标准与反向映射的导数绝对值相同
  function depthDerivative(d, near, far) {
    return (far * near) / ((far - near) * d * d);
  }

  // 把存储深度步长换算成世界空间距离步长
  function worldStep(d, near, far, mode, reverse) {
    const lsb = storageLSB(d, near, far, mode, reverse);
    return lsb / depthDerivative(d, near, far);
  }

  // 墙面 d 与贴片 d+gap 之间，量化后的存储深度差；返回理想差、量化差与 LSB 倍数
  function depthDeltaAt(d, gap, near, far, mode, reverse) {
    const s1 = storedDepth(d, near, far, reverse);
    const s2 = storedDepth(d + gap, near, far, reverse);
    const q1 = quantize(s1, mode);
    const q2 = quantize(s2, mode);
    const idealDelta = Math.abs(s2 - s1);
    const quantizedDelta = Math.abs(q2 - q1);
    const lsb = storageLSB(d, near, far, mode, reverse);
    return {
      idealDelta,
      quantizedDelta,
      lsb,
      lsbCount: idealDelta / lsb,
      collide: quantizedDelta === 0,
    };
  }

  function formatSci(x, digits = 3) {
    if (x === 0) return "0";
    if (!Number.isFinite(x)) return String(x);
    const exp = Math.floor(Math.log10(Math.abs(x)));
    const mantissa = x / Math.pow(10, exp);
    return `${mantissa.toFixed(digits)}e${exp >= 0 ? "+" : ""}${exp}`;
  }

  return {
    UNORM24_LEVELS,
    perspective,
    storedDepth,
    quantize,
    f32Ulp,
    storageLSB,
    depthDerivative,
    worldStep,
    depthDeltaAt,
    formatSci,
  };
});
