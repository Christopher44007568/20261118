import { BACKGROUND } from './scene.js';

const BG = BACKGROUND.map((v) => Math.round(v * 255));

// 场景中使用的前景色调色板（见 scene.js 的 mesh 颜色）。
const PALETTE = [
  [250, 77, 77],   // 红
  [242, 204, 64],  // 黄
  [64, 217, 230],  // 青
  [166, 115, 242], // 紫
];

function nearestForeground(r, g, b) {
  let best = PALETTE[0];
  let bestDist = Infinity;
  for (const color of PALETTE) {
    const dist = (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  }
  return best;
}

// 基于解析后的普通纹理读取像素（readPixels 作用于 resolve FBO，而非多重采样 FBO）。
export function readResolvePixels(gl, target, x, y, radius) {
  const size = radius * 2 + 1;
  const px = Math.max(0, x - radius);
  const py = Math.max(0, y - radius);
  const w = Math.min(size, target.width - px);
  const h = Math.min(size, target.height - py);
  const pixels = new Uint8Array(size * size * 4);
  pixels.fill(0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.resolveFbo);
  gl.readPixels(px, py, w, h, gl.RGBA, gl.UNSIGNED_BYTE,
    pixels.subarray(0, w * h * 4));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { pixels, size, x, y };
}

// 估算单个前景像素的覆盖率：以右下方的背景邻居作为底色参考，
// 颜色 = 覆盖*前景 + (1-覆盖)*背景，覆盖取 RGB 三通道中位数。
export function coverageAt(pixels, size, cx, cy) {
  const idx = (cy * size + cx) * 4;
  const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
  const distToBg = Math.hypot(r - BG[0], g - BG[1], b - BG[2]);
  if (distToBg < 12) {
    return { coverage: 0, isBackground: true, isEdge: false, rgb: [r, g, b] };
  }
  // 场景背景是固定常量色，直接以全局背景色为基准；
  // 这样在检查窗口边缘（找不到背景邻居）时仍然稳定。
  const [baseR, baseG, baseB] = BG;
  const foreground = nearestForeground(r, g, b);
  const covs = [r, g, b].map((value, ch) => {
    const base = [baseR, baseG, baseB][ch];
    const denom = foreground[ch] - base;
    if (Math.abs(denom) < 4) return 1;
    return Math.min(1, Math.max(0, (value - base) / denom));
  });
  const coverage = covs.sort((a, b) => a - b)[1];
  const isEdge = coverage > 0.02 && coverage < 0.98;
  return { coverage, isBackground: false, isEdge, rgb: [r, g, b] };
}

export class PixelInspector {
  constructor(canvas, infoEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.infoEl = infoEl;
    this.radius = 5;
    this.locked = null;
    this.hover = null;
  }

  update(gl, target, canvasX, canvasY) {
    this.hover = { x: canvasX, y: canvasY };
    // hover 优先：鼠标在画布上时实时跟随；移出后回退到锁定点。
    const point = this.hover || this.locked;
    if (!point) return;
    if (point.x < 0 || point.y < 0 || point.x >= target.width || point.y >= target.height) {
      return;
    }
    // point.y 已在事件处理中转换为 GL 原点（左下角）坐标。
    const glY = point.y;
    const { pixels, size } = readResolvePixels(
      gl, target, point.x, glY, this.radius
    );
    this._draw(pixels, size);
    const center = coverageAt(pixels, size, this.radius, this.radius);
    const [r, g, b] = center.rgb;
    const displayY = target.height - 1 - point.y;
    this.infoEl.textContent =
      `检查点 (${point.x}, ${displayY})${this.locked ? ' [已锁定]' : ''}\n` +
      `RGBA = (${r}, ${g}, ${b}, 255)\n` +
      `估算覆盖率 = ${(center.coverage * 100).toFixed(1)}%` +
      (center.isEdge ? '\n边缘混合像素：多重采样平均后的中间色' :
        center.isBackground ? '\n背景像素' : '\n纯前景像素（完全覆盖）');
  }

  clear() {
    this.hover = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.infoEl.textContent = '将鼠标移到画布上检查像素';
  }

  _draw(pixels, size) {
    const ctx = this.ctx;
    const cell = this.canvas.width / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        ctx.fillStyle =
          `rgb(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]})`;
        ctx.fillRect(x * cell, (size - 1 - y) * cell, cell, cell);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    const c = this.radius * cell;
    ctx.strokeRect(c, c, cell, cell);
  }
}

// 全帧扫描：统计背景/纯前景/边缘混合像素及覆盖质量总和。
// 覆盖质量总和 = 纯前景像素数 + 边缘像素覆盖率之和；
// 正确的 MSAA 只改变边缘像素分布，该值在不同采样数下应几乎不变（形状不变）。
export function analyzeFrame(gl, target) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.resolveFbo);
  const pixels = new Uint8Array(target.width * target.height * 4);
  gl.readPixels(0, 0, target.width, target.height, gl.RGBA,
    gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const { width: w, height: h } = target;
  let background = 0, foreground = 0, edge = 0, mass = 0;
  const edgeDepths = {};
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = coverageAt(pixels, w, x, y);
      if (c.isBackground) {
        background++;
      } else if (c.isEdge) {
        edge++;
        mass += c.coverage;
        const bucket = Math.round(c.coverage * 8);
        edgeDepths[bucket] = (edgeDepths[bucket] || 0) + 1;
      } else {
        foreground++;
        mass += 1;
      }
    }
  }
  return { background, foreground, edge, mass, edgeDepths };
}
