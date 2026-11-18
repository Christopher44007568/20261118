/* Node 数值验证：投影映射端点、量化规则、各配置远端精度与 z-fighting 预测。 */
const assert = require("assert");
const M = require("../js/math.js");

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL  ${name}: ${err.message}`);
  }
}

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

check("标准 Z 端点映射到 0/1", () => {
  assert.strictEqual(M.storedDepth(0.1, 0.1, 100, false), 0);
  assert.strictEqual(M.storedDepth(100, 0.1, 100, false), 1);
});

check("反向 Z 端点映射到 1/0", () => {
  assert.strictEqual(M.storedDepth(0.1, 0.1, 100, true), 1);
  assert.strictEqual(M.storedDepth(100, 0.1, 100, true), 0);
});

check("24 位量化步长恒为 2^-24", () => {
  const lsb = M.storageLSB(9000, 0.01, 10000, "depth24", false);
  assert.ok(Math.abs(lsb - Math.pow(2, -24)) < 1e-12);
  assert.strictEqual(M.quantize(0.5, "depth24"),
    Math.round(0.5 * M.UNORM24_LEVELS) / M.UNORM24_LEVELS);
});

check("32 位浮点 ULP 随数值指数变化", () => {
  assert.strictEqual(M.f32Ulp(1), Math.pow(2, -23));
  assert.strictEqual(M.f32Ulp(0.5), Math.pow(2, -24));
  assert.strictEqual(M.f32Ulp(0), Math.pow(2, -149));
});

check("反向深度在远端的世界空间步长远小于标准 Z", () => {
  const n = 0.01, f = 10000, d = 9000;
  const reverseStep = M.worldStep(d, n, f, "reverse", true);
  const standard24Step = M.worldStep(d, n, f, "depth24", false);
  const standardF32Step = M.worldStep(d, n, f, "depth32f", false);
  assert.ok(reverseStep < standardF32Step / 1e5,
    `reverse ${reverseStep} vs f32 ${standardF32Step}`);
  assert.ok(reverseStep < standard24Step / 1e5,
    `reverse ${reverseStep} vs unorm24 ${standard24Step}`);
});

console.log("\n== 9 组配置在墙面处的深度差与冲突预测 ==");
const header = ["mode", "preset", "ratio", "idealDelta", "lsb", "lsbCount",
  "worldStep", "quantizedCollide"];
console.log(header.join("\t"));
MODES.forEach((mode) => {
  Object.entries(PRESETS).forEach(([name, range]) => {
    const d = range.far * 0.9;
    const info = M.depthDeltaAt(d, GAP, range.near, range.far, mode.id, mode.reverse);
    const step = M.worldStep(d, range.near, range.far, mode.id, mode.reverse);
    console.log([
      mode.label.padEnd(9),
      name.padEnd(7),
      M.formatSci(range.far / range.near, 0).padStart(9),
      M.formatSci(info.idealDelta).padStart(11),
      M.formatSci(info.lsb).padStart(11),
      info.lsbCount.toFixed(3).padStart(9),
      M.formatSci(step).padStart(11),
      info.collide ? "COLLIDE" : "ok",
    ].join("\t"));
  });
});

check("极端比例下标准 Z 两种方案均冲突，反向深度不冲突", () => {
  const r = PRESETS.extreme;
  const d = r.far * 0.9;
  const std24 = M.depthDeltaAt(d, GAP, r.near, r.far, "depth24", false);
  const std32 = M.depthDeltaAt(d, GAP, r.near, r.far, "depth32f", false);
  const rev = M.depthDeltaAt(d, GAP, r.near, r.far, "reverse", true);
  assert.strictEqual(std24.collide, true);
  assert.strictEqual(std32.collide, true);
  assert.strictEqual(rev.collide, false);
  assert.ok(rev.lsbCount > 1, `反向深度 LSB 倍数应大于 1，实际 ${rev.lsbCount}`);
});

check("反向深度的远端世界步长保持毫米级以内", () => {
  const r = PRESETS.extreme;
  const step = M.worldStep(r.far * 0.9, r.near, r.far, "reverse", true);
  assert.ok(step < 0.01, `远端步长 ${step} 超过 1 厘米`);
});

process.exit(failures === 0 ? 0 : 1);
