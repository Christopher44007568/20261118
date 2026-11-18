/*
 * CPU 模拟可视化后端：当 WebGL2 / 离屏 FBO 不可用时，
 * 用 2D canvas 复现同一画面，并叠加量化条纹、z-fighting 与闪烁高亮。
 * 接口与 DepthRenderer.render 对齐，返回 CpuDepthSim 的像素计数。
 */
(function (root) {
  class CpuDepthView {
    constructor(canvas) {
      // 原 canvas 已占用 WebGL 上下文，无法再取 2D 上下文；
      // 在其位置上叠加一个同尺寸的独立 2D canvas 作为 CPU 渲染面。
      this.sourceCanvas = canvas;
      const drawCanvas = document.createElement("canvas");
      drawCanvas.width = canvas.width;
      drawCanvas.height = canvas.height;
      drawCanvas.className = "cpu-overlay";
      drawCanvas.style.width = "100%";
      drawCanvas.style.height = "auto";
      drawCanvas.style.display = "block";
      canvas.style.display = "none";
      canvas.parentNode.insertBefore(drawCanvas, canvas.nextSibling);
      const errorBox = document.getElementById("webgl-error");
      if (errorBox) errorBox.classList.add("hidden");
      this.canvas = drawCanvas;
      this.width = drawCanvas.width;
      this.height = drawCanvas.height;
      this.ctx = drawCanvas.getContext("2d");
      this.backendName = "CPU 模拟（深度量化逐像素计算）";
    }

    // 展开式示意投影：屏幕布局不随极端距离塌缩。
    // 以墙面距离为基准做一次透视除法并归一化，使几何在任意裁剪比下保持固定尺寸，
    // 深度精度差异完全通过量化条纹与冲突高亮的颜色来表达。
    project(x, y, d, cfg) {
      const f = 1 / Math.tan(cfg.fovy / 2);
      const aspect = this.width / this.height;
      const ref = cfg.wallZ;
      // 示意放大：把远处物体的真实张角放大到可观察尺寸，
      // 不改变深度量化与冲突判定（那些由 CpuDepthSim 独立计算）
      const schematic = ref / (f * 12);
      const ndcX = (f / aspect) * x / ref;
      const ndcY = f * y / ref;
      return [
        (ndcX * schematic * 0.5 + 0.5) * this.width,
        (0.5 - ndcY * schematic * 0.5) * this.height,
      ];
    }

    drawBox(center, hx, hy, d, cfg, fill, stroke) {
      const ctx = this.ctx;
      const corners = [
        this.project(center[0] - hx, center[1] - hy, d, cfg),
        this.project(center[0] + hx, center[1] - hy, d, cfg),
        this.project(center[0] + hx, center[1] + hy, d, cfg),
        this.project(center[0] - hx, center[1] + hy, d, cfg),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      corners.slice(1).forEach(([px, py]) => ctx.lineTo(px, py));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    render(cfg) {
      const ctx = this.ctx;
      const W = this.width, H = this.height;
      ctx.fillStyle = "#0d121a";
      ctx.fillRect(0, 0, W, H);

      // 近处薄片：固定在画面左侧的示意位置（真实近距物体会占据更大视野）
      this.drawBox([0.35 - 4.6, 0.6], 0.9, 1.2, cfg.sheetZ, cfg,
        "#5cd19e", "#2e7d5c");
      // 远处墙面
      this.drawBox([0.35, 0], 3.2, 2.2, cfg.wallZ, cfg,
        "#52769e", "#2a4058");

      // 贴片：逐像素列绘制，按量化桶产生条纹
      const simCfg = { ...cfg, width: W, height: H };
      const frame = root.CpuDepthSim.simulateFrame(simCfg, 0);
      const jittered = root.CpuDepthSim.simulateFrame(simCfg, cfg.jitter / 2);
      const baseMap = new Map(frame.map((p) => [`${p.x},${p.y}`, p]));
      const jitMap = new Map(jittered.map((p) => [`${p.x},${p.y}`, p]));
      const decalRect = {
        tl: this.project(0.35 - 1.15, 1.15, cfg.wallZ - cfg.gap, cfg),
        br: this.project(0.35 + 1.15, -1.15, cfg.wallZ - cfg.gap, cfg),
      };
      const wallRect = {
        tl: this.project(0.35 - 3.2, 2.2, cfg.wallZ, cfg),
        br: this.project(0.35 + 3.2, -2.2, cfg.wallZ, cfg),
      };

      for (let x = 0; x < W; x += 1) {
        let columnTie = false;
        let columnFlicker = false;
        let depthValue = null;
        for (let y = 0; y < H; y += 1) {
          const pixel = baseMap.get(`${x},${y}`);
          if (!pixel) continue;
          depthValue = pixel.decalStored;
          if (pixel.winner === "tie") columnTie = true;
          if (jitMap.get(`${x},${y}`).winner !== pixel.winner) columnFlicker = true;
        }
        if (depthValue === null) continue;
        // 用贴片在该列的量化深度桶编号驱动条纹，桶越粗条纹越宽
        const lsb = root.DepthMath.storageLSB(
          cfg.wallZ, cfg.near, cfg.far, cfg.depthMode, cfg.reverse
        );
        const bucket = Math.floor(depthValue / lsb);
        const stripeShade = 0.7 + (bucket % 2) * 0.45;
        let color;
        if (columnTie) color = `rgba(255,80,80,${0.55 * stripeShade + 0.3})`;
        else if (columnFlicker) color = "rgba(255,210,80,0.5)";
        else color = cfg.reverse
          ? `rgba(90,220,140,${0.45 * stripeShade + 0.3})`
          : `rgba(235,112,72,${0.45 * stripeShade + 0.25})`;
        ctx.fillStyle = color;
        // 条纹仅绘制在墙面与贴片的横向重叠区间内
        if (x < wallRect.tl[0] || x > wallRect.br[0]) continue;
        ctx.fillRect(x, decalRect.tl[1], 1, decalRect.br[1] - decalRect.tl[1]);
      }

      // 贴片边框
      this.drawBox([0.35, 0], 1.15, 1.15, cfg.wallZ - cfg.gap, cfg,
        "rgba(255,255,255,0)", "#ffd0b0");

      const result = root.CpuDepthSim.evaluate(simCfg);
      return {
        zFightPixels: result.zFightPixels,
        flickerPixels: result.flickerPixels,
      };
    }
  }

  root.CpuDepthView = CpuDepthView;
})(typeof self !== "undefined" ? self : globalThis);
