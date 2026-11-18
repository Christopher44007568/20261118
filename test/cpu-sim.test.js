/* CPU 模拟器 9 组配置评测：输出深度差、z-fighting 与闪烁像素数。 */
const assert = require("assert");
const M = require("../js/math.js");
const Sim = require("../js/cpu-sim.js");

const PRESETS = {
  mild: { near: 0.1, far: 100 },
  wide: { near: 0.1, far: 1000 },
  extreme: { near: 0.01, far: 10000 },
};
const MODES = [
  { id: "depth24", reverse: false, label: "depth24" },
  { id: "depth32f", reverse: false, label: "depth32" },
  { id: "reverse", reverse: true, label: "reverse-z" },
];
const GAP = 0.001;
const WIDTH = 960;
const HEIGHT = 600;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); }
  catch (err) { failures += 1; console.error(`FAIL  ${name}: ${err.message}`); }
}

function buildConfig(mode, range) {
  const wallZ = range.far * 0.9;
  const worldStep = M.worldStep(wallZ, range.near, range.far, mode.id, mode.reverse);
  const jitterFactor = 1.5;
  return {
    width: WIDTH,
    height: HEIGHT,
    depthMode: mode.id,
    reverse: mode.reverse,
    near: range.near,
    far: range.far,
    gap: GAP,
    wallZ,
    jitter: Math.max(worldStep * jitterFactor, 1e-12),
    slope: Math.max(worldStep * 8 / 2.3, 1e-12),
  };
}

console.log("\n== CPU 模拟：9 组配置深度差与像素计数 ==");
const rows = [];
MODES.forEach((mode) => {
  Object.entries(PRESETS).forEach(([presetName, range]) => {
    const cfg = buildConfig(mode, range);
    const delta = M.depthDeltaAt(
      cfg.wallZ, GAP, cfg.near, cfg.far, mode.id, mode.reverse
    );
    const result = Sim.evaluate(cfg);
    rows.push({ mode, presetName, range, cfg, delta, result });
    console.log([
      mode.label.padEnd(9),
      presetName.padEnd(7),
      `ratio=1:${M.formatSci(range.far / range.near, 0)}`.padStart(12),
      `Δs=${M.formatSci(delta.idealDelta)}`.padStart(14),
      `lsb=${M.formatSci(delta.lsb)}`.padStart(14),
      `Δ/lsb=${delta.lsbCount.toFixed(2)}`.padStart(12),
      `zfight=${String(result.zFightPixels).padStart(5)}`,
      `flicker=${String(result.flickerPixels).padStart(5)}`,
      `covered=${result.coveredPixels}`,
    ].join(" "));
  });
});

check("极端比例下标准 Z 全贴片冲突，反向深度零冲突", () => {
  const ext = rows.filter((r) => r.presetName === "extreme");
  const std24 = ext.find((r) => r.mode.id === "depth24");
  const std32 = ext.find((r) => r.mode.id === "depth32f");
  const rev = ext.find((r) => r.mode.id === "reverse");
  // 倾斜贴片在粗量化下绝大部分像素与墙面落入同一深度桶
  assert.ok(std24.result.zFightPixels > std24.result.coveredPixels * 0.1,
    `depth24 冲突占比过低: ${std24.result.zFightPixels}`);
  assert.ok(std32.result.zFightPixels > std32.result.coveredPixels * 0.1,
    `depth32 冲突占比过低: ${std32.result.zFightPixels}`);
  assert.strictEqual(rev.result.zFightPixels, 0);
  assert.strictEqual(rev.result.flickerPixels, 0);
});

check("标准 Z 在温和/拉远比例下也出现冲突，反向深度始终干净", () => {
  rows.forEach((row) => {
    if (row.mode.id === "reverse") {
      assert.strictEqual(row.result.zFightPixels, 0,
        `${row.mode.id}/${row.presetName} 不应冲突`);
    } else {
      assert.ok(row.result.zFightPixels > 0,
        `${row.mode.id}/${row.presetName} 应出现 z-fighting`);
    }
  });
});

check("模拟器中心像素的量化深度与 math.js 直接计算一致", () => {
  const cfg = buildConfig(MODES[0], PRESETS.extreme);
  const frame = Sim.simulateFrame(cfg, 0);
  const center = frame[Math.floor(frame.length / 2)];
  const expected = M.quantize(
    M.storedDepth(cfg.wallZ, cfg.near, cfg.far, false), "depth24"
  );
  assert.strictEqual(center.wallStored, expected);
});

check("反向深度极端比例仍保留多个 LSB 的远端余量", () => {
  const rev = rows.find((r) => r.mode.id === "reverse" && r.presetName === "extreme");
  assert.ok(rev.delta.lsbCount > 10,
    `LSB 倍数应大于 10，实际 ${rev.delta.lsbCount}`);
});

process.exit(failures === 0 ? 0 : 1);
