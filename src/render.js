// Sphere renderer: shades a sphere with the clearcoat BRDF.
// Camera looks down -Z at a unit sphere at origin; light is a directional
// source in the XZ plane at `lightAngleDeg` elevation from the view axis
// (0 = normal incidence toward viewer, 85 = grazing).
const { norm } = require('./brdf');
const { shadeBase, shadeClearcoat } = require('./brdf');
const { Image } = require('./png');

function lightDirection(angleDeg) {
  const t = (angleDeg * Math.PI) / 180;
  return norm([Math.sin(t), 0, Math.cos(t)]);
}

// mode: 'total' | 'base' | 'coat'
function renderSphere(opts) {
  const {
    size = 256,
    lightAngleDeg = 0,
    baseParams,
    coatParams = null,   // null => bare base layer
    mode = 'total',
    exposure = 1.0,
    lightIntensity = 3.0,
    ambient = 0.03,
  } = opts;

  const img = new Image(size, size);
  const L = lightDirection(lightAngleDeg);
  const V = [0, 0, 1];
  const radius = size * 0.46;
  const cx = size / 2, cy = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx + 0.5) / radius;
      const dy = (cy - y - 0.5) / radius;
      const r2 = dx * dx + dy * dy;
      if (r2 > 1) {
        img.set(x, y, [0.012, 0.012, 0.014]); // background
        continue;
      }
      const N = norm([dx, dy, Math.sqrt(1 - r2)]);
      let rgb;
      if (coatParams) {
        const r = shadeClearcoat(N, V, L, baseParams, coatParams);
        rgb = mode === 'coat' ? r.coat : mode === 'base' ? r.base : r.total;
      } else {
        const r = shadeBase(N, V, L, baseParams);
        rgb = mode === 'coat' ? [0, 0, 0] : r.total;
      }
      img.set(x, y, rgb.map((c) => c * lightIntensity + ambient));
    }
  }
  return { img, png: img.toPNG(exposure) };
}

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// Scanline analysis: walk the sphere's horizontal diameter and record
// per-pixel coat/base intensity + surface normal. coatParams may be null
// (bare base reference). Used to locate highlight peaks and compare them.
function scanlineProfile(opts) {
  const { size = 512, lightAngleDeg = 0, baseParams, coatParams } = opts;
  const L = lightDirection(lightAngleDeg);
  const V = [0, 0, 1];
  const radius = size * 0.46;
  const cx = size / 2, cy = size / 2;
  const samples = [];
  for (let x = 0; x < size; x++) {
    const dx = (x - cx + 0.5) / radius;
    const r2 = dx * dx;
    if (r2 > 1) continue;
    const N = norm([dx, 0, Math.sqrt(1 - r2)]);
    if (coatParams) {
      const r = shadeClearcoat(N, V, L, baseParams, coatParams);
      samples.push({
        x: dx, normal: N,
        coat: lum(r.coat), base: lum(r.base), total: lum(r.total),
        Fc: r.Fc,
      });
    } else {
      const r = shadeBase(N, V, L, baseParams);
      samples.push({ x: dx, normal: N, coat: 0, base: lum(r.total), total: lum(r.total), Fc: 0 });
    }
  }
  return samples;
}

function peakOf(samples, key) {
  let best = null;
  for (const s of samples) if (!best || s[key] > best[key]) best = s;
  return best;
}

module.exports = { renderSphere, scanlineProfile, peakOf, lightDirection };
