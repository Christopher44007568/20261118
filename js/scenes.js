// 程序化线性 HDR 场景（Float32 RGB，无裁切，峰值远高于 1）
const Scenes = (() => {

  // 确定性 value noise
  function makeNoise(seed) {
    const hash = (x, y) => {
      let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
      h = (h ^ (h >> 13)) | 0;
      h = Math.imul(h, 1274126177);
      return (((h ^ (h >> 16)) >>> 0) / 4294967295);
    };
    const smooth = t => t * t * (3 - 2 * t);
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = smooth(xf), v = smooth(yf);
      return hash(xi, yi) * (1 - u) * (1 - v) + hash(xi + 1, yi) * u * (1 - v)
           + hash(xi, yi + 1) * (1 - u) * v + hash(xi + 1, yi + 1) * u * v;
    };
  }
  function fbm(noise, x, y, oct) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { v += amp * noise(x * f, y * f); amp *= 0.5; f *= 2; }
    return v;
  }

  const lerp = (a, b, t) => a + (b - a) * t;

  // ---- 日落：天空渐变 + 超高亮太阳 + 云层 + 海面反射 ----
  function sunset(w, h) {
    const d = new Float32Array(w * h * 3);
    const noise = makeNoise(7);
    const sunX = 0.5 * w, sunY = 0.62 * h, sunR = 0.055 * h;
    const horizon = 0.72 * h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const ny = y / h;
        let r, g, b;
        if (y < horizon) {
          // 天空：地平线暖橙 → 天顶蓝紫
          const t = Math.min(1, y / horizon);
          r = lerp(0.10, 2.4, Math.pow(1 - t, 2.2));
          g = lerp(0.16, 0.9, Math.pow(1 - t, 3.0));
          b = lerp(0.38, 0.35, Math.pow(1 - t, 1.6));
          // 云：噪声条带，受光面暖
          const cl = fbm(noise, x / w * 6, y / h * 14, 4);
          const cloud = Math.max(0, cl - 0.55) * 2.2 * (1 - t * 0.6);
          r += cloud * 1.6; g += cloud * 0.7; b += cloud * 0.5;
        } else {
          // 海面：深色 + 太阳列反射
          const st = (y - horizon) / (h - horizon);
          r = 0.02 + 0.05 * (1 - st); g = 0.03 + 0.05 * (1 - st); b = 0.08 + 0.06 * (1 - st);
          const dxw = (x - sunX) / w;
          const glint = Math.exp(-dxw * dxw * 900) * (0.4 + 0.6 * noise(x * 0.4, y * 0.9));
          r += glint * 3.0 * (1 - st * 0.7);
          g += glint * 1.1 * (1 - st * 0.7);
          b += glint * 0.4 * (1 - st * 0.7);
        }
        // 太阳本体 + 大气辉光（峰值 ~250）
        const dx = x - sunX, dy = y - sunY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const disk = Math.max(0, 1 - dist / sunR);
        const glow = Math.exp(-dist / (0.09 * h));
        r += disk * 240 + glow * 6.0;
        g += disk * 150 + glow * 2.6;
        b += disk * 60  + glow * 1.0;
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    }
    return d;
  }

  // ---- 室内暗部：低照度房间 + 窗外高光 + 台灯 ----
  function indoor(w, h) {
    const d = new Float32Array(w * h * 3);
    const noise = makeNoise(21);
    const winX0 = 0.58 * w, winX1 = 0.92 * w, winY0 = 0.12 * h, winY1 = 0.62 * h;
    const lampX = 0.18 * w, lampY = 0.55 * h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const ny = y / h;
        // 墙面/地板：极暗，带轻微梯度与纹理
        const tex = 0.8 + 0.4 * fbm(noise, x / w * 8, y / h * 8, 3);
        let r, g, b;
        if (ny > 0.8) { r = 0.012; g = 0.009; b = 0.007; }          // 地板
        else          { r = 0.020; g = 0.016; b = 0.014; }          // 墙
        r *= tex; g *= tex; b *= tex;
        // 窗外：明亮天空 + 远处楼影（峰值 ~25）
        if (x > winX0 && x < winX1 && y > winY0 && y < winY1) {
          const wt = (y - winY0) / (winY1 - winY0);
          r = lerp(6, 22, 1 - wt); g = lerp(7, 18, 1 - wt); b = lerp(9, 14, 1 - wt);
          const bld = fbm(noise, x / w * 10, 3.7, 2);
          if (bld > 0.62 && wt > 0.45) { r *= 0.15; g *= 0.15; b *= 0.18; }
        }
        // 窗框
        const frame = 0.012 * w;
        const inWinX = x > winX0 - frame && x < winX1 + frame;
        const inWinY = y > winY0 - frame && y < winY1 + frame;
        if (inWinX && inWinY &&
            (Math.abs(x - (winX0 + winX1) / 2) < frame * 0.5 ||
             Math.abs(y - (winY0 + winY1) / 2) < frame * 0.5 ||
             x < winX0 || x > winX1 || y < winY0 || y > winY1)) {
          r = 0.008; g = 0.007; b = 0.006;
        }
        // 台灯：暖色点光 + 灯罩亮斑（峰值 ~8）
        const dx = x - lampX, dy = y - lampY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const shade = Math.max(0, 1 - dist / (0.05 * h));
        const spill = Math.exp(-dist / (0.22 * h));
        r += shade * 7 + spill * 0.35;
        g += shade * 4.5 + spill * 0.20;
        b += shade * 2.0 + spill * 0.08;
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    }
    return d;
  }

  // ---- 霓虹：近黑背景 + 高饱和彩色灯管（色相偏移测试） ----
  function neon(w, h) {
    const d = new Float32Array(w * h * 3);
    const noise = makeNoise(42);
    // 灯管定义：线段 + 颜色 + 强度
    const tubes = [
      { x0: 0.10, y0: 0.25, x1: 0.45, y1: 0.25, c: [1, 0.05, 0.25], k: 40 },  // 品红横管
      { x0: 0.45, y0: 0.25, x1: 0.45, y1: 0.55, c: [1, 0.05, 0.25], k: 40 },
      { x0: 0.55, y0: 0.30, x1: 0.90, y1: 0.30, c: [0.05, 0.9, 1], k: 35 },   // 青
      { x0: 0.55, y0: 0.30, x1: 0.55, y1: 0.60, c: [0.05, 0.9, 1], k: 35 },
      { x0: 0.12, y0: 0.72, x1: 0.38, y1: 0.72, c: [1, 0.55, 0.05], k: 30 },  // 橙
      { x0: 0.60, y0: 0.65, x1: 0.85, y1: 0.80, c: [0.4, 0.1, 1], k: 45 },    // 紫斜管
    ];
    const segDist = (px, py, t) => {
      const ax = t.x0 * w, ay = t.y0 * h, bx = t.x1 * w, by = t.y1 * h;
      const vx = bx - ax, vy = by - ay;
      const tt = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
      const dx = px - (ax + vx * tt), dy = py - (ay + vy * tt);
      return Math.sqrt(dx * dx + dy * dy);
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        // 背景：潮湿墙面微光
        const tex = fbm(noise, x / w * 5, y / h * 5, 3);
        let r = 0.004 + 0.004 * tex, g = 0.004 + 0.003 * tex, b = 0.006 + 0.005 * tex;
        for (const t of tubes) {
          const dist = segDist(x, y, t);
          const core = Math.max(0, 1 - dist / (0.008 * h));        // 灯管芯
          const bloom = Math.exp(-dist / (0.05 * h));              // 辉光
          const coreI = core * core * t.k;
          r += t.c[0] * (coreI + bloom * t.k * 0.06);
          g += t.c[1] * (coreI + bloom * t.k * 0.06);
          b += t.c[2] * (coreI + bloom * t.k * 0.06);
        }
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    }
    return d;
  }

  const SCENES = {
    sunset: { name: '日落 Sunset', gen: sunset,
      info: '太阳亮度峰值 ≈ 170（约 10 档动态范围），观察高光肩部压缩与云层细节恢复。' },
    indoor: { name: '室内暗部 Indoor', gen: indoor,
      info: '大部分像素 < 0.05，窗外峰值 ≈ 20，观察暗部 toe 与窗口高光恢复。' },
    neon: { name: '霓虹 Neon', gen: neon,
      info: '高饱和灯管交叠处峰值 ≈ 50，观察按通道算子的色相偏移（品红→白）。' },
  };

  return { SCENES };
})();

if (typeof module !== 'undefined') module.exports = Scenes;
