// 色调映射算子：全部接收「曝光已施加后的线性 HDR RGB」，返回 0..1 显示值。
// 关键点：不存在任何隐藏预裁切 —— 每个算子看到的是同一份线性数据。

const Tonemap = (() => {

  // 1) Linear：纯线性缩放，仅在最终显示端 clamp（用于暴露高光损失）
  function linear(rgb, out, i) {
    out[i]     = clamp01(rgb[i]);
    out[i + 1] = clamp01(rgb[i + 1]);
    out[i + 2] = clamp01(rgb[i + 2]);
  }

  // 2) Reinhard：经典 x/(1+x)，按通道作用（高光去饱和，色相偏移可见）
  function reinhard(rgb, out, i) {
    out[i]     = rgb[i]     / (1 + rgb[i]);
    out[i + 1] = rgb[i + 1] / (1 + rgb[i + 1]);
    out[i + 2] = rgb[i + 2] / (1 + rgb[i + 2]);
  }

  // 3) ACES 近似（Narkowicz 2015 拟合），按通道
  function aces(rgb, out, i) {
    out[i]     = acesFit(rgb[i]);
    out[i + 1] = acesFit(rgb[i + 1]);
    out[i + 2] = acesFit(rgb[i + 2]);
  }
  function acesFit(x) {
    const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp01((x * (a * x + b)) / (x * (c * x + d) + e));
  }

  // 4) Custom：log2(EV) 域内 5 个控制点的单调三次插值（Fritsch–Carlson）
  //    points: [{ev, y}] 固定 ev 位置，y 由滑杆控制
  const CUSTOM_EVS = [-10, -5, -1, 3, 8];
  let customY = [0.0, 0.09, 0.42, 0.82, 1.0];

  function setCustomPoint(idx, y) { customY[idx] = y; }
  function getCustomPoints() {
    return CUSTOM_EVS.map((ev, i) => ({ ev, y: customY[i] }));
  }

  // 单调三次 Hermite（Fritsch-Carlson 斜率限制）
  function makeMonotone(xs, ys) {
    const n = xs.length;
    const dx = [], m = [];
    for (let k = 0; k < n - 1; k++) {
      dx.push(xs[k + 1] - xs[k]);
      m.push((ys[k + 1] - ys[k]) / dx[k]);
    }
    const t = new Array(n);
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let k = 1; k < n - 1; k++) {
      t[k] = (m[k - 1] * m[k] <= 0) ? 0 : (m[k - 1] + m[k]) / 2;
    }
    for (let k = 0; k < n - 1; k++) {
      if (m[k] === 0) { t[k] = 0; t[k + 1] = 0; continue; }
      const a = t[k] / m[k], b = t[k + 1] / m[k];
      const s = a * a + b * b;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        t[k] = tau * a * m[k];
        t[k + 1] = tau * b * m[k];
      }
    }
    return { xs, ys, t };
  }

  function evalMonotone(spl, x) {
    const { xs, ys, t } = spl;
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const u = (x - xs[k]) / h;
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[k]
         + (u3 - 2 * u2 + u) * h * t[k]
         + (-2 * u3 + 3 * u2) * ys[k + 1]
         + (u3 - u2) * h * t[k + 1];
  }

  // 自定义曲线作用在亮度上，保持色相（与按通道算子形成对照）
  function makeCustomMapper() {
    const spl = makeMonotone(CUSTOM_EVS, customY.slice());
    const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return function (rgb, out, i) {
      const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
      const l = lumOf(r, g, b);
      if (l <= 1e-8) { out[i] = out[i + 1] = out[i + 2] = 0; return; }
      const ev = Math.log2(l);
      const nl = clamp01(evalMonotone(spl, ev));
      const s = nl / l;
      out[i]     = clamp01(r * s);
      out[i + 1] = clamp01(g * s);
      out[i + 2] = clamp01(b * s);
    };
  }

  // 标量版（用于曲线绘制 / 中间灰求解），输入为亮度
  function scalarOps() {
    const custom = makeCustomMapper();
    const buf = new Float32Array(3);
    return {
      linear:   x => clamp01(x),
      reinhard: x => x / (1 + x),
      aces:     x => acesFit(x),
      custom:   x => { buf[0] = buf[1] = buf[2] = x; custom(buf, buf, 0); return buf[0]; },
    };
  }

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  // 数值求解「映射到输出 0.5 的输入亮度」（二分，曲线单调）
  function solveInputForOutput(fn, target) {
    let lo = 1e-6, hi = 4096;
    for (let i = 0; i < 60; i++) {
      const mid = Math.sqrt(lo * hi);
      if (fn(mid) < target) lo = mid; else hi = mid;
    }
    return Math.sqrt(lo * hi);
  }

  const OPERATORS = [
    { id: 'linear',   name: 'Linear',            tag: '纯缩放 · 显示端裁切', fn: linear },
    { id: 'reinhard', name: 'Reinhard',          tag: 'x/(1+x) · 按通道',    fn: reinhard },
    { id: 'aces',     name: 'ACES (近似)',        tag: 'Narkowicz 拟合',      fn: aces },
    { id: 'custom',   name: 'Custom (保色相)',    tag: 'EV 域单调样条 · 按亮度', fn: null }, // 动态生成
  ];

  return { OPERATORS, makeCustomMapper, scalarOps, setCustomPoint, getCustomPoints,
           solveInputForOutput, clamp01, CUSTOM_EVS };
})();

if (typeof module !== 'undefined') module.exports = Tonemap;
