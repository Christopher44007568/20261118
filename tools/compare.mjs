// CPU oblique-light comparison renders for the two exported seeds.
// Renders a tiled plane lit by a low sun (azimuth 35 deg, elevation 25 deg):
//   left  = near (mip 0), right = far (forced mip 3, what trilinear LOD picks
//   at distance). Verifies normal direction, seam invisibility and distant
//   sampling stability outside the browser.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { encodePNG } from './png.mjs';
import { buildMips } from './validate.mjs';

const SIZE = 512;
const RENDER = 640;
const TILES = 3;
const FAR_MIP = 3;
const SEEDS = [1234, 9876];
const OUT = new URL('../artifacts/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const wasm = await WebAssembly.instantiate(
  readFileSync(new URL('../dist/rockgen.wasm', import.meta.url)),
  { env: { abort: () => { throw new Error('wasm abort'); } } }
);
const ex = wasm.instance.exports;

function generate(seed) {
  ex.generate(seed, SIZE);
  const n = SIZE * SIZE * 4;
  const mem = new Uint8Array(ex.memory.buffer);
  const grab = (ptr) => new Uint8Array(mem.slice(ptr, ptr + n));
  return {
    albedo: grab(ex.getAlbedoPtr()),
    roughness: grab(ex.getRoughnessPtr()),
    normal: grab(ex.getNormalPtr()),
  };
}

function bilinear(tex, size, u, v, c) {
  const x = u * size - 0.5, y = v * size - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const w = (xx, yy) => tex[(((yy % size) + size) % size * size + ((xx % size) + size) % size) * 4 + c];
  return w(x0, y0) * (1 - fx) * (1 - fy) + w(x0 + 1, y0) * fx * (1 - fy)
       + w(x0, y0 + 1) * (1 - fx) * fy + w(x0 + 1, y0 + 1) * fx * fy;
}

// Oblique light: low sun from the upper-left.
const az = 35 * Math.PI / 180, el = 25 * Math.PI / 180;
const L = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];

function renderOblique(maps, mipLevel) {
  const mips = {
    albedo: buildMips(maps.albedo, SIZE)[mipLevel],
    roughness: buildMips(maps.roughness, SIZE)[mipLevel],
    normal: buildMips(maps.normal, SIZE)[mipLevel],
  };
  const ms = SIZE >> mipLevel;
  const img = new Uint8Array(RENDER * RENDER * 4);
  let ndotlSum = 0, lumSum = 0, ndotl2 = 0, lum2 = 0, ndotlLum = 0, n = 0;
  for (let y = 0; y < RENDER; y++) {
    for (let x = 0; x < RENDER; x++) {
      const u = (x / RENDER) * TILES % 1, v = (y / RENDER) * TILES % 1;
      const nx = bilinear(mips.normal, ms, u, v, 0) / 255 * 2 - 1;
      const ny = bilinear(mips.normal, ms, u, v, 1) / 255 * 2 - 1;
      const nz = bilinear(mips.normal, ms, u, v, 2) / 255 * 2 - 1;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const ndotl = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
      const rough = bilinear(mips.roughness, ms, u, v, 0) / 255;
      // Blinn specular, view straight down.
      const hx = L[0], hy = L[1], hz = L[2] + 1;
      const hl = Math.hypot(hx, hy, hz);
      const ndoth = Math.max(0, (nx * hx + ny * hy + nz * hz) / (nl * hl));
      const spec = Math.pow(ndoth, 4 + 60 * (1 - rough)) * (1 - rough) * 0.6;
      const light = 0.18 + 0.82 * ndotl;
      const o = (y * RENDER + x) * 4;
      let lum = 0;
      for (let c = 0; c < 3; c++) {
        const a = bilinear(mips.albedo, ms, u, v, c) / 255;
        const srgb = Math.min(1, a * light + spec);
        img[o + c] = Math.round(Math.pow(srgb, 1 / 2.2) * 255);
        lum += srgb;
      }
      img[o + 3] = 255;
      lum /= 3;
      ndotlSum += ndotl; lumSum += lum; ndotl2 += ndotl * ndotl;
      lum2 += lum * lum; ndotlLum += ndotl * lum; n++;
    }
  }
  // Pearson correlation between surface orientation and brightness: proves
  // the normal field (not a blur) drives the oblique-light response.
  const cov = ndotlLum / n - (ndotlSum / n) * (lumSum / n);
  const corr = cov / Math.sqrt((ndotl2 / n - (ndotlSum / n) ** 2) * (lum2 / n - (lumSum / n) ** 2));
  return { img, corr, meanLum: lumSum / n };
}

// Mean abs diff of the lit render across tile boundaries vs interior.
function litSeamMetric(img) {
  const at = (x, y, c) => img[(y * RENDER + x) * 4 + c];
  let seam = 0, interior = 0, cnt = 0;
  const step = RENDER / TILES;
  for (let y = 0; y < RENDER; y++) {
    for (let t = 1; t < TILES; t++) {
      const xs = Math.round(t * step);
      for (let c = 0; c < 3; c++) {
        seam += Math.abs(at(xs, y, c) - at(xs - 1, y, c));
        interior += Math.abs(at(xs - 40, y, c) - at(xs - 41, y, c));
        cnt++;
      }
    }
  }
  return (seam / cnt) / (interior / cnt);
}

console.log(`oblique light: azimuth 35 deg, elevation 25 deg, tiles ${TILES}x${TILES}`);
let failures = 0;
const sheets = [];
for (const seed of SEEDS) {
  const maps = generate(seed);
  const near = renderOblique(maps, 0);
  const far = renderOblique(maps, FAR_MIP);
  const seamNear = litSeamMetric(near.img);
  const seamFar = litSeamMetric(far.img);
  const lumDrift = Math.abs(near.meanLum - far.meanLum) / near.meanLum;
  console.log(`\nseed ${seed}:`);
  console.log(`  normal-direction correlation (near ${near.corr.toFixed(3)} / far ${far.corr.toFixed(3)})`);
  console.log(`  lit seam ratio (near ${seamNear.toFixed(3)} / far ${seamFar.toFixed(3)})`);
  console.log(`  near->far mean luminance drift ${(lumDrift * 100).toFixed(2)}%`);
  if (near.corr < 0.4 || far.corr < 0.4) { console.log('  FAIL normal-direction correlation too low'); failures++; }
  if (seamNear > 1.5 || seamFar > 1.5) { console.log('  FAIL lit seam visible'); failures++; }
  if (lumDrift > 0.05) { console.log('  FAIL distant sampling unstable'); failures++; }

  // Side-by-side sheet: near | far.
  const sheet = new Uint8Array(RENDER * 2 * RENDER * 4);
  for (let y = 0; y < RENDER; y++) {
    near.img.copyWithin(0, 0, 0); // no-op keeps buffers alive
    sheet.set(near.img.subarray(y * RENDER * 4, (y + 1) * RENDER * 4), (y * RENDER * 2) * 4);
    sheet.set(far.img.subarray(y * RENDER * 4, (y + 1) * RENDER * 4), (y * RENDER * 2 + RENDER) * 4);
  }
  writeFileSync(`${OUT}compare_seed${seed}_oblique.png`, encodePNG(sheet, RENDER * 2, RENDER));
  sheets.push(sheet);
  console.log(`  wrote artifacts/compare_seed${seed}_oblique.png (left=near mip0, right=far mip${FAR_MIP})`);
}

// Combined two-seed sheet.
const combined = new Uint8Array(RENDER * 2 * RENDER * 2 * 4);
combined.set(sheets[0]);
combined.set(sheets[1], sheets[0].length);
writeFileSync(`${OUT}compare_seeds_oblique.png`, encodePNG(combined, RENDER * 2, RENDER * 2));
console.log(`\nwrote artifacts/compare_seeds_oblique.png (top=seed ${SEEDS[0]}, bottom=seed ${SEEDS[1]})`);
console.log(failures === 0 ? 'COMPARISON PASSED' : `${failures} COMPARISON CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
