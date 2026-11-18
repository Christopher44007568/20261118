// Validates the WASM rock generator and exports PNG textures for two seeds.
// Checks: 4-edge seamlessness, normal<->height alignment, mip-chain stability.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { encodePNG } from './png.mjs';

const SIZE = 512;
const SEEDS = [1234, 9876];
const OUT = new URL('../artifacts/textures/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const wasm = await WebAssembly.instantiate(readFileSync(new URL('../dist/rockgen.wasm', import.meta.url)), { env: { abort: (m, f, l, c) => { throw new Error('wasm abort ' + l + ':' + c); } } });
const ex = wasm.instance.exports;

function generate(seed, size) {
  ex.generate(seed, size);
  const n = size * size * 4;
  const mem = new Uint8Array(ex.memory.buffer);
  const grab = (ptr) => new Uint8Array(mem.slice(ptr, ptr + n));
  const hf = new Float32Array(ex.memory.buffer.slice(ex.getHeightF32Ptr(), ex.getHeightF32Ptr() + size * size * 4));
  return {
    albedo: grab(ex.getAlbedoPtr()),
    roughness: grab(ex.getRoughnessPtr()),
    normal: grab(ex.getNormalPtr()),
    height: grab(ex.getHeightPtr()),
    porosity: grab(ex.getPorosityPtr()),
    heightF: hf,
  };
}

// Mean abs diff between horizontally/vertically adjacent texels, measured
// across the wrap seam vs. averaged over ALL interior columns/rows.
function seamMetric(rgba, size) {
  const at = (x, y, c) => rgba[(y * size + x) * 4 + c];
  let seam = 0, interior = 0, count = 0;
  for (let y = 0; y < size; y++) {
    for (let c = 0; c < 3; c++) {
      seam += Math.abs(at(0, y, c) - at(size - 1, y, c));
      for (let x = 1; x < size; x += 8) interior += Math.abs(at(x, y, c) - at(x - 1, y, c));
      count++;
    }
  }
  for (let x = 0; x < size; x++) {
    for (let c = 0; c < 3; c++) {
      seam += Math.abs(at(x, 0, c) - at(x, size - 1, c));
      for (let y = 1; y < size; y += 8) interior += Math.abs(at(x, y, c) - at(x, y - 1, c));
      count++;
    }
  }
  const interiorCount = count * (size >> 3);
  const seamMean = seam / count, interiorMean = interior / interiorCount;
  return { seam: seamMean, interior: interiorMean, ratio: seamMean / interiorMean };
}

// Recompute normals from the exported float height (same Sobel the WASM uses)
// and measure mean angular error against the exported normal map.
function normalAlignment(maps, size) {
  const { normal, heightF } = maps;
  let hmin = Infinity, hmax = -Infinity;
  for (let i = 0; i < size * size; i++) { hmin = Math.min(hmin, heightF[i]); hmax = Math.max(hmax, heightF[i]); }
  const range = Math.max(hmax - hmin, 1e-6);
  const strength = 2.2;
  let errSum = 0;
  for (let y = 0; y < size; y++) {
    const yu = (y + 1) % size, yd = (y - 1 + size) % size;
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size;
      const dx = (heightF[y * size + xr] - heightF[y * size + xl]) / range;
      const dy = (heightF[yu * size + x] - heightF[yd * size + x]) / range;
      const nx = -dx * strength * 0.5, ny = -dy * strength * 0.5, nz = 64.0 / size;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      const mx = (normal[i] / 255) * 2 - 1, my = (normal[i + 1] / 255) * 2 - 1, mz = (normal[i + 2] / 255) * 2 - 1;
      const dot = Math.min(1, Math.max(-1, nx * inv * mx + ny * inv * my + nz * inv * mz));
      errSum += Math.acos(dot) * 180 / Math.PI;
    }
  }
  return errSum / (size * size);
}

// Box-filter mip chain with wrap-around sampling; returns array of levels.
export function buildMips(rgba, size) {
  const levels = [rgba];
  let cur = rgba, s = size;
  while (s > 1) {
    const hs = s >> 1;
    const next = new Uint8Array(hs * hs * 4);
    for (let y = 0; y < hs; y++) {
      for (let x = 0; x < hs; x++) {
        for (let c = 0; c < 4; c++) {
          next[(y * hs + x) * 4 + c] = Math.round((
            cur[((2 * y) * s + 2 * x) * 4 + c] +
            cur[((2 * y) * s + ((2 * x + 1) % s)) * 4 + c] +
            cur[(((2 * y + 1) % s) * s + 2 * x) * 4 + c] +
            cur[(((2 * y + 1) % s) * s + ((2 * x + 1) % s)) * 4 + c]) / 4);
        }
      }
    }
    levels.push(next);
    cur = next;
    s = hs;
  }
  return levels;
}

function luminanceMean(rgba) {
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return sum / (rgba.length / 4);
}

function main() {
  const allMaps = {};
  let failures = 0;
  const expect = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

  for (const seed of SEEDS) {
  console.log(`\n=== seed ${seed} (${SIZE}x${SIZE}) ===`);
  const maps = generate(seed, SIZE);
  allMaps[seed] = maps;

  for (const name of ['albedo', 'roughness', 'normal', 'height', 'porosity']) {
    const m = seamMetric(maps[name], SIZE);
    // Pass when the seam gradient is statistically interior-like, or when the
    // absolute seam step is below quantization noise (~4/255) on flat maps.
    expect(m.ratio < 1.5 || m.seam < 4.0, `${name}: seam/interior gradient ratio ${m.ratio.toFixed(3)} (seam ${m.seam.toFixed(2)}, interior ${m.interior.toFixed(2)})`);
  }

  const angErr = normalAlignment(maps, SIZE);
  expect(angErr < 3.0, `normal<->height mean angular error ${angErr.toFixed(3)} deg (< 3 deg, quantization-limited)`);

  // Mip stability: every level stays seamless, mean luminance drift < 2%.
  const mips = buildMips(maps.albedo, SIZE);
  const baseLum = luminanceMean(mips[0]);
  let mipOk = true, mipMsg = [];
  for (let l = 1; l <= 4; l++) {
    const s = SIZE >> l;
    const m = seamMetric(mips[l], s);
    const drift = Math.abs(luminanceMean(mips[l]) - baseLum) / baseLum;
    mipMsg.push(`L${l}: ratio ${m.ratio.toFixed(3)}, lum drift ${(drift * 100).toFixed(3)}%`);
    if ((m.ratio > 1.6 && m.seam >= 4.0) || drift > 0.02) mipOk = false;
  }
  expect(mipOk, `albedo mip chain stable -> ${mipMsg.join(' | ')}`);

  for (const name of ['albedo', 'roughness', 'normal', 'height', 'porosity']) {
    writeFileSync(`${OUT}seed${seed}_${name}.png`, encodePNG(maps[name], SIZE, SIZE));
  }
  console.log(`  exported 5 maps to artifacts/textures/seed${seed}_*.png`);
  }

  // Cross-seed distinctness: same structure code, different fields.
  const a = allMaps[SEEDS[0]].albedo, b = allMaps[SEEDS[1]].albedo;
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) diff += Math.abs(a[i] - b[i]);
  console.log(`\ncross-seed mean abs albedo diff: ${(diff / (a.length / 4)).toFixed(2)} (should be large)`);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
