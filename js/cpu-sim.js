/*
 * CPU 光栅化模拟器：逐像素复现透视投影 + 深度缓冲量化 + 深度测试。
 * 与 js/math.js 的量化规则完全一致，用于在无可用 GPU 的环境中
 * 确定性地统计 z-fighting 与接触闪烁像素数量。
 * 浏览器与 Node 均可加载。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./math.js"));
  } else if (typeof root !== "undefined") {
    root.CpuDepthSim = factory(root.DepthMath);
  }
})(typeof self !== "undefined" ? self : globalThis, function (M) {
  // 贴片在屏幕空间覆盖的像素区域（与渲染器中 1.15 半宽、居中偏右的几何对应）
  function decalCoverage(width, height) {
    const cx = Math.floor(width * 0.54);
    const cy = Math.floor(height * 0.5);
    const rx = Math.floor(width * 0.13);
    const ry = Math.floor(height * 0.21);
    const pixels = [];
    for (let y = cy - ry; y <= cy + ry; y += 1) {
      for (let x = cx - rx; x <= cx + rx; x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        pixels.push([x, y]);
      }
    }
    return pixels;
  }

  /*
   * 模拟一帧：墙面深度恒定，贴片沿 X 微倾斜，深度随像素 x 线性变化。
   * 返回每个覆盖像素的墙面/贴片量化深度与深度测试胜者。
   */
  function simulateFrame(cfg, jitter) {
    const width = cfg.width;
    const height = cfg.height;
    const pixels = decalCoverage(width, height);
    const wallDepth = cfg.wallZ - jitter;
    const wallStored = M.quantize(
      M.storedDepth(wallDepth, cfg.near, cfg.far, cfg.reverse), cfg.depthMode
    );
    const results = [];
    pixels.forEach(([x, y]) => {
      // 贴片局部 X 坐标（屏幕 x 映射回 -1.15..1.15）
      const localX = ((x / width) - 0.54) / 0.13 * 1.15;
      const decalWorld = cfg.wallZ - cfg.gap + cfg.slope * localX - jitter;
      const decalStored = M.quantize(
        M.storedDepth(decalWorld, cfg.near, cfg.far, cfg.reverse), cfg.depthMode
      );
      // 深度测试：标准 Z 越小越近，反向 Z 越大越近；相等时按渲染顺序贴片胜出
      let winner;
      if (decalStored === wallStored) winner = "tie";
      else if (!cfg.reverse) winner = decalStored < wallStored ? "decal" : "wall";
      else winner = decalStored > wallStored ? "decal" : "wall";
      results.push({ x, y, wallStored, decalStored, winner });
    });
    return results;
  }

  /*
   * 完整评测：基准帧 + 抖动帧。
   * zFight：基准帧中两表面量化深度完全相同的像素。
   * flicker：抖动后深度比较结果（tie / decal / wall）发生变化的像素。
   */
  function evaluate(cfg) {
    // 基准帧向 +Z 抖动半个步长，对比帧向 -Z 抖动半个步长，
    // 总位移约一个量化桶，恰好在桶边界触发归属翻转。
    const base = simulateFrame(cfg, cfg.jitter / 2);
    const jittered = simulateFrame(cfg, -cfg.jitter / 2);
    let zFightPixels = 0;
    let flickerPixels = 0;
    const tiePixels = [];
    base.forEach((pixel, i) => {
      if (pixel.winner === "tie") {
        zFightPixels += 1;
        tiePixels.push(pixel);
      }
      if (pixel.winner !== jittered[i].winner) flickerPixels += 1;
    });
    return {
      coveredPixels: base.length,
      zFightPixels,
      flickerPixels,
      base,
      jittered,
    };
  }

  return { decalCoverage, simulateFrame, evaluate };
});
