// Clearcoat PBR experiment driver.
// Usage: node main.js   -> writes all artifacts into ./artifacts
//
// Experiments:
//  1. Light sweep 0..85 deg: track coat vs base highlight position/intensity,
//     plus a bare-base reference to isolate the coat's attenuation.
//  2. Normal independence: change coatRoughness, verify the base normal and
//     base lobe are bit-identical (coat roughness never touches the base).
//  3. Renders: per-angle spheres, isolated lobes, roughness strip, grazing.
const fs = require('fs');
const path = require('path');
const { renderSphere, scanlineProfile, peakOf } = require('./src/render');
const { shadeClearcoat, norm, fresnelSchlick, f0FromIor } = require('./src/brdf');
const { Image } = require('./src/png');

const OUT = path.join(__dirname, 'artifacts');
fs.mkdirSync(OUT, { recursive: true });
const write = (name, buf) => fs.writeFileSync(path.join(OUT, name), buf);

// --- Material under test ---
// Base: red dielectric paint, fairly glossy so its highlight is comparable
// to the coat's and both stay visible at once.
const BASE = { albedo: [0.62, 0.07, 0.045], metallic: 0.0, roughness: 0.18 };
const COAT = {
  coatIor: 1.5,
  coatRoughness: 0.08,
  coatThickness: 1.0,
  coatAbsorption: [0.10, 0.16, 0.16], // subtle warm tint from the coat medium
};

// ---------- Experiment 1: light-angle sweep ----------
function sweep() {
  const rows = [];
  for (let angle = 0; angle <= 85; angle += 5) {
    const coated = scanlineProfile({
      size: 1024, lightAngleDeg: angle, baseParams: BASE, coatParams: COAT,
    });
    const bare = scanlineProfile({
      size: 1024, lightAngleDeg: angle, baseParams: BASE, coatParams: null,
    });
    const coatPeak = peakOf(coated, 'coat');
    const basePeak = peakOf(coated, 'base');
    const barePeak = peakOf(bare, 'base');
    rows.push({
      angle,
      coatPeakX: +coatPeak.x.toFixed(4),
      coatPeakValue: +coatPeak.coat.toFixed(5),
      coatPeakNormal: coatPeak.normal.map((v) => +v.toFixed(4)),
      coatPeakFc: +coatPeak.Fc.toFixed(5),
      basePeakX: +basePeak.x.toFixed(4),
      basePeakValue: +basePeak.base.toFixed(5),
      basePeakNormal: basePeak.normal.map((v) => +v.toFixed(4)),
      bareBasePeakValue: +barePeak.base.toFixed(5),
      peakSeparation: +Math.abs(coatPeak.x - basePeak.x).toFixed(4),
      coatToBaseRatio: +(coatPeak.coat / Math.max(basePeak.base, 1e-9)).toFixed(4),
      baseTransmission: +(basePeak.base / Math.max(barePeak.base, 1e-9)).toFixed(4),
    });
  }
  return rows;
}

// ---------- Experiment 2: coat roughness must not touch the base ----------
function verifyNormalIndependence() {
  const coatA = { ...COAT, coatRoughness: 0.05 };
  const coatB = { ...COAT, coatRoughness: 0.60 };
  const V = [0, 0, 1];
  let maxBaseDiff = 0;
  let probes = 0;
  for (let deg = 0; deg <= 85; deg += 5) {
    const t = (deg * Math.PI) / 180;
    const L = norm([Math.sin(t), 0, Math.cos(t)]);
    for (let nx = -0.9; nx <= 0.9001; nx += 0.1) {
      // Same geometric normal N is fed to both calls: the coat has no normal
      // of its own, so the base normal cannot depend on coatRoughness.
      const N = norm([nx, 0.2, Math.sqrt(Math.max(0.01, 1 - nx * nx - 0.04))]);
      const ra = shadeClearcoat(N, V, L, BASE, coatA);
      const rb = shadeClearcoat(N, V, L, BASE, coatB);
      for (let i = 0; i < 3; i++) {
        maxBaseDiff = Math.max(maxBaseDiff, Math.abs(ra.base[i] - rb.base[i]));
      }
      probes++;
    }
  }
  return {
    probes,
    coatRoughnessA: coatA.coatRoughness,
    coatRoughnessB: coatB.coatRoughness,
    maxBaseLobeDiff: maxBaseDiff,
    maxBaseNormalDiff: 0, // N is a shared input, not derived from coat params
    pass: maxBaseDiff === 0,
  };
}

// ---------- Plot helper: sweep curves (coat / coated base / bare base) ----------
function drawSweepPlot(rows) {
  const W = 640, H = 400, pad = 48;
  const img = new Image(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.set(x, y, [0.02, 0.02, 0.025]);
  const maxV = Math.max(...rows.map((r) => Math.max(r.coatPeakValue, r.bareBasePeakValue)));
  const log = (v) => Math.log10(Math.max(v, 1e-3));
  const lo = log(1e-3), hi = log(maxV);
  const px = (a) => pad + ((W - 2 * pad) * a) / 85;
  const py = (v) => H - pad - ((H - 2 * pad) * (log(v) - lo)) / (hi - lo);
  const line = (x0, y0, x1, y1, c) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      if (x >= 0 && x < W && y >= 0 && y < H) img.set(x, y, c);
    }
  };
  line(pad, H - pad, W - pad, H - pad, [0.25, 0.25, 0.25]);
  line(pad, pad, pad, H - pad, [0.25, 0.25, 0.25]);
  for (let a = 0; a <= 85; a += 15) line(px(a), H - pad, px(a), H - pad + 5, [0.4, 0.4, 0.4]);
  const series = [
    ['coatPeakValue', [0.95, 0.95, 0.95]],   // coat highlight: white
    ['basePeakValue', [0.9, 0.15, 0.1]],     // coated base highlight: red
    ['bareBasePeakValue', [0.95, 0.6, 0.1]], // bare base reference: orange
  ];
  for (const [key, color] of series) {
    for (let i = 1; i < rows.length; i++) {
      line(px(rows[i - 1].angle), py(rows[i - 1][key]), px(rows[i].angle), py(rows[i][key]), color);
    }
  }
  return img.toPNG(1.0);
}

// ---------- Renders ----------
function renderAll(report) {
  for (const angle of [0, 55, 85]) {
    write(`angle-${angle}.png`, renderSphere({
      size: 320, lightAngleDeg: angle, baseParams: BASE, coatParams: COAT, exposure: 1.4,
    }).png);
  }
  write('preview-01.png', renderSphere({
    size: 384, lightAngleDeg: 35, baseParams: BASE, coatParams: COAT, exposure: 1.4,
  }).png);

  // Isolated lobes at 40 deg: base-only vs coat-only.
  write('view-base.png', renderSphere({
    size: 320, lightAngleDeg: 40, baseParams: BASE, coatParams: COAT, mode: 'base', exposure: 1.4,
  }).png);
  write('view-coat.png', renderSphere({
    size: 320, lightAngleDeg: 40, baseParams: BASE, coatParams: COAT, mode: 'coat', exposure: 1.4,
  }).png);

  // Roughness strip: coatRoughness 0.03..0.6, base highlight must stay put.
  write('e2e-roughness.png', stripImage(
    [0.03, 0.08, 0.2, 0.4, 0.6].map((r) => ({ ...COAT, coatRoughness: r })), 40
  ));

  // Normal-independence e2e: extreme coat roughness pair, base lobe isolated.
  write('e2e-normal.png', stripImage(
    [{ ...COAT, coatRoughness: 0.05 }, { ...COAT, coatRoughness: 0.6 }], 55, 'base'
  ));

  // Grazing comparison: bare base vs clearcoated at 80 deg.
  const bare = renderSphere({
    size: 200, lightAngleDeg: 80, baseParams: BASE, coatParams: null, exposure: 1.4,
  }).img;
  const coated = renderSphere({
    size: 200, lightAngleDeg: 80, baseParams: BASE, coatParams: COAT, exposure: 1.4,
  }).img;
  write('e2e-grazing.png', sideBySide([bare, coated]));

  write('sweep-plot.png', drawSweepPlot(report.sweep));
}

function stripImage(coatVariants, lightAngleDeg, mode = 'total') {
  const imgs = coatVariants.map((coat) => renderSphere({
    size: 160, lightAngleDeg, baseParams: BASE, coatParams: coat, mode, exposure: 1.4,
  }).img);
  return sideBySide(imgs);
}

function sideBySide(imgs) {
  const gap = 8;
  const w = imgs[0].width, h = imgs[0].height;
  const out = new Image(imgs.length * w + (imgs.length - 1) * gap, h);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) out.set(x, y, [0.02, 0.02, 0.025]);
  }
  imgs.forEach((im, k) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out.set(k * (w + gap) + x, y, im.get(x, y));
    }
  });
  return out.toPNG(1.4);
}

// ---------- Driver ----------
function main() {
  const sweepRows = sweep();
  const normalCheck = verifyNormalIndependence();

  const f0c = f0FromIor(COAT.coatIor);
  const fresnelCurve = [];
  for (let deg = 0; deg <= 85; deg += 5) {
    const Fc = fresnelSchlick(f0c, Math.cos((deg * Math.PI) / 180));
    fresnelCurve.push({ angle: deg, Fc: +Fc.toFixed(5), transmission: +((1 - Fc) * (1 - Fc)).toFixed(5) });
  }
  const first = sweepRows[0];
  const last = sweepRows[sweepRows.length - 1];
  const maxSep = Math.max(...sweepRows.map((r) => r.peakSeparation));

  const report = {
    material: { base: BASE, coat: COAT },
    model: {
      base: 'Lambert diffuse + GGX specular (metallic-roughness)',
      coat: 'dielectric GGX lobe, F0 from coatIor, Beer-Lambert absorption over the double path, Fresnel (1-Fc)^2 transmission into the base',
      layering: 'total = coat + base * transmission; the coat attenuates but never replaces the base color',
    },
    sweep: sweepRows,
    fresnelCurve,
    normalIndependence: normalCheck,
    findings: {
      highlightPosition:
        `coat and base highlights share the half-vector direction: max peak separation ` +
        `${maxSep.toFixed(4)} (normalized surface x) across 0-85 deg`,
      highlightIntensity:
        `coat peak grows ${first.coatPeakValue.toFixed(2)} -> ${last.coatPeakValue.toFixed(2)} ` +
        `(Fc ${first.coatPeakFc.toFixed(3)} -> ${last.coatPeakFc.toFixed(3)}) as incidence goes grazing, ` +
        `while base transmission falls ${first.baseTransmission.toFixed(3)} -> ${last.baseTransmission.toFixed(3)} ` +
        `via (1-Fc)^2 + coat absorption; coat/base peak ratio ${first.coatToBaseRatio.toFixed(2)} -> ${last.coatToBaseRatio.toFixed(2)}`,
      grazingFresnel:
        `at the coat-air interface Fc rises ${fresnelCurve[0].Fc.toFixed(3)} -> ${fresnelCurve[fresnelCurve.length - 1].Fc.toFixed(3)} `
        + `and base transmission (1-Fc)^2 falls ${fresnelCurve[0].transmission.toFixed(3)} -> `
        + `${fresnelCurve[fresnelCurve.length - 1].transmission.toFixed(3)} from normal incidence to grazing`,
      normalIndependence: normalCheck.pass
        ? `PASS: base lobe bit-identical for coatRoughness ${normalCheck.coatRoughnessA} vs ` +
          `${normalCheck.coatRoughnessB} across ${normalCheck.probes} probes`
        : 'FAIL',
    },
  };
  write('report.json', Buffer.from(JSON.stringify(report, null, 2)));
  renderAll(report);

  console.log('normal independence:', normalCheck.pass ? 'PASS' : 'FAIL',
    '(maxBaseLobeDiff =', normalCheck.maxBaseLobeDiff + ')');
  console.log('angle  coatX   coat     baseX   base     bareBase  Fc      T_base  ratio');
  for (const r of sweepRows.filter((_, i) => i % 3 === 0 || i === sweepRows.length - 1)) {
    console.log(
      `  ${String(r.angle).padStart(2)}  ${r.coatPeakX.toFixed(3)}  ${r.coatPeakValue.toFixed(3).padStart(8)}` +
      `  ${r.basePeakX.toFixed(3)}  ${r.basePeakValue.toFixed(3).padStart(8)}  ${r.bareBasePeakValue.toFixed(3).padStart(8)}` +
      `  ${r.coatPeakFc.toFixed(3)}  ${r.baseTransmission.toFixed(3)}  ${r.coatToBaseRatio.toFixed(2)}`
    );
  }
  console.log('artifacts written to', OUT);
}

main();
