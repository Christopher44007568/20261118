// VSM demo: hard / soft / light-bleeding panels side by side + error stats.
"use strict";
const fs = require("fs");
const path = require("path");
const { m4 } = require("./math");
const { buildScene } = require("./scene");
const { rasterize, MomentTexture } = require("./vsm");
const { makeLights, shade, errorStats } = require("./render");
const { encodePNG } = require("./png");
const { drawText } = require("./font");

const W = 480, H = 360, SHADOW = 512;
const OUT = path.join(__dirname, "..", "artifacts");
fs.mkdirSync(OUT, { recursive: true });

// Shadow bias / VSM parameters (reported in stats).
// biasMult scales each light's baseBias (sun 0.06 / spot 0.01).
const PARAMS = {
  hard:      { biasMult: 1.0 },
  soft:      { biasMult: 0.3, minVariance: 5e-4, bleeding: 0.15, blurSigma: 2.0 },
  // Error case: variance floor tuned too high and the light-bleeding
  // suppression remap disabled -> Chebyshev overestimates visibility and
  // light leaks into the slab's shadow on the ground.
  bleedCase: { biasMult: 0.3, minVariance: 0.12, bleeding: 0.0, blurSigma: 2.0 },
  reference: { biasMult: 1.0, pcfRadius: 4 / SHADOW },
};

const camEye = [7.5, 6.5, 9.5], camTarget = [0, 0.6, 0];
const camView = m4.lookAt(camEye, camTarget, [0, 1, 0]);
const camProj = m4.perspective((40 * Math.PI) / 180, W / H, 0.5, 60);
const camVP = m4.multiply(camProj, camView);

function tonemap(img) {
  const out = Buffer.alloc(img.length);
  for (let i = 0; i < img.length; i++) {
    const cl = Math.min(1, Math.max(0, img[i]));
    const c = cl / (1 + cl); // Reinhard
    out[i] = Math.round(Math.pow(c, 1 / 2.2) * 255);
  }
  return out;
}

function renderFrame(moverX, label) {
  const scene = buildScene(moverX);
  const lights = makeLights();
  const mts = lights.map((L) => new MomentTexture(L, SHADOW));
  // Static crate moved -> depth-moment textures of both lights must refresh.
  mts.forEach((mt) => mt.invalidate());
  let rebuilt = 0;
  mts.forEach((mt) => { if (mt.update(scene)) rebuilt++; });
  console.log(`[${label}] moment textures rebuilt: ${rebuilt}/${mts.length} (mover x=${moverX})`);

  const cam = rasterize(scene, camVP, camView, W, H, "camera");
  cam.width = W; cam.height = H;

  // VSM paths sample blurred moment copies (per-path blur radius).
  const blurredCopy = (mt, sigma) => {
    const c = Object.assign(Object.create(Object.getPrototypeOf(mt)), mt);
    c.moments = Float32Array.from(mt.moments);
    if (sigma > 0) c.blur(sigma);
    return c;
  };
  const mtsSoft = mts.map((mt) => blurredCopy(mt, PARAMS.soft.blurSigma));
  const mtsBleed = mts.map((mt) => blurredCopy(mt, PARAMS.bleedCase.blurSigma));

  const ref = shade(cam, scene, mts, lights, "reference", PARAMS.reference);
  const hard = shade(cam, scene, mts, lights, "hard", PARAMS.hard);
  const soft = shade(cam, scene, mtsSoft, lights, "vsm", PARAMS.soft);
  const bleed = shade(cam, scene, mtsBleed, lights, "vsm", PARAMS.bleedCase);

  // Leak probe: ground pixels inside the slab's spotlight shadow band,
  // where the correct spot visibility is ~0 and bleeding shows up as > 0.
  const probe = [];
  for (let i = 0; i < W * H; i++) {
    if (cam.meshId[i] !== 0) continue; // ground mesh only
    const x = cam.worldPos[i * 3], z = cam.worldPos[i * 3 + 2];
    if ((x > 2.92 && x < 3.05 && z > 0.3 && z < 2.3) ||
        (x > 0.5 && x < 2.5 && z > 2.52 && z < 2.6)) probe.push(i);
  }
  const leakStats = (mode) => {
    let mean = 0, se = 0;
    for (const i of probe) {
      mean += mode.visSum[i];
      const e = mode.visSum[i] - ref.visSum[i];
      se += e * e;
    }
    return { meanVis: mean / probe.length, rmse: Math.sqrt(se / probe.length) };
  };
  const stats = {
    hard: errorStats(hard.visSum, ref.visSum, cam.zbuf),
    softVSM: errorStats(soft.visSum, ref.visSum, cam.zbuf),
    bleedingCase: errorStats(bleed.visSum, ref.visSum, cam.zbuf),
    leakProbe: {
      pixels: probe.length,
      reference: leakStats(ref),
      hard: leakStats(hard),
      softVSM: leakStats(soft),
      bleedingCase: leakStats(bleed),
    },
  };
  return { hard, soft, bleed, ref, stats };
}

function compose(panels, titles, file) {
  const bar = 26, gap = 4;
  const Wc = panels.length * W + (panels.length - 1) * gap;
  const Hc = H + bar;
  const img = Buffer.alloc(Wc * Hc * 3);
  panels.forEach((p, i) => {
    const rgb = tonemap(p.img);
    const ox = i * (W + gap);
    for (let y = 0; y < H; y++)
      rgb.copy(img, ((bar + y) * Wc + ox) * 3, y * W * 3, (y + 1) * W * 3);
    drawText(img, Wc, ox + 8, 7, titles[i], 2, [230, 230, 230]);
  });
  fs.writeFileSync(file, encodePNG(Wc, Hc, img));
  console.log("wrote", path.relative(process.cwd(), file));
}

// ---- Frame 1 ----
const f1 = renderFrame(2.5, "frame1");
compose([f1.hard, f1.soft, f1.bleed, f1.ref],
  ["A HARD 1-TAP", "B SOFT VSM", "C VSM BLEED", "REFERENCE"],
  path.join(OUT, "vsm_panels_frame1.png"));

// ---- Frame 2: the "static" crate moves -> moment textures are rebuilt ----
const f2 = renderFrame(0.2, "frame2-moved");
compose([f2.hard, f2.soft, f2.bleed, f2.ref],
  ["A HARD 1-TAP", "B SOFT VSM", "C VSM BLEED", "REFERENCE"],
  path.join(OUT, "vsm_panels_frame2_moved.png"));

const report = {
  shadowMapSize: SHADOW,
  lights: ["directional", "spot"],
  parameters: PARAMS,
  frame1: f1.stats,
  frame2_moved: f2.stats,
};
fs.writeFileSync(path.join(OUT, "stats.json"), JSON.stringify(report, null, 2));

// Compact console summary.
console.log("\n=== shadow bias / VSM parameters ===");
console.log("sun.baseBias=0.06  spot.baseBias=0.03  (effective bias = biasMult * baseBias)");
for (const [k, v] of Object.entries(PARAMS)) console.log(" ", k, JSON.stringify(v));
console.log("\n=== frame1 error vs 64-tap PCF reference ===");
for (const k of ["hard", "softVSM", "bleedingCase"]) {
  const s = f1.stats[k];
  console.log("  " + k.padEnd(12) + " RMSE=" + s.rmse.toFixed(4) +
    " MAE=" + s.mae.toFixed(4) + " maxAbs=" + s.maxAbs.toFixed(3));
}
console.log("=== frame1 leak probe (slab shadow band, lower=closer to reference) ===");
for (const k of ["reference", "hard", "softVSM", "bleedingCase"]) {
  const s = f1.stats.leakProbe[k];
  console.log("  " + k.padEnd(12) + " meanVis=" + s.meanVis.toFixed(3) +
    " RMSE=" + s.rmse.toFixed(4));
}
