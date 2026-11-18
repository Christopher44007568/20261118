// Node verification harness. The decode routines exercised here are the same
// JS reference implementation mirrored by the GLSL shaders, so these numbers
// describe what the GPU reconstructs.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  makeLargePlane, makeSmallCube, makeSlivers, makeUvSeamQuad, makeSphere,
} from '../src/mesh.js';
import {
  compressMesh, decompressMesh,
  sourceByteCount, compressedByteCount,
} from '../src/compress.js';
import { analyze, frameOrthonormalError } from '../src/stats.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const report = { generatedAt: new Date().toISOString(), meshes: [] };

function check(name, condition, detail) {
  if (!condition) failures.push(`${name}: ${detail}`);
  return condition;
}

const meshes = [
  makeLargePlane(),
  makeSmallCube(),
  makeSlivers(),
  makeSphere(),
  makeUvSeamQuad(),
];

const normalLengthLimit = { oct16: 0.02, oct32: 1e-3 };
const frameLimit = 1e-5;

for (const mesh of meshes) {
  for (const mode of ['oct16', 'oct32']) {
    const packed = compressMesh(mesh, { mode });
    const decoded = decompressMesh(mesh, packed);
    const stats = analyze(mesh, decoded, packed);
    const frameErr = frameOrthonormalError(decoded);
    const srcBytes = sourceByteCount(stats.vertexCount);
    const cmpBytes = compressedByteCount(packed);
    const entry = {
      mesh: mesh.name, mode, vertexCount: stats.vertexCount,
      bytes: {
        source: srcBytes,
        compressed: cmpBytes,
        perVertexSource: srcBytes / stats.vertexCount,
        perVertexCompressed: packed.stride,
        ratio: srcBytes / cmpBytes,
      },
      position: stats.position,
      uv: stats.uv,
      normal: stats.normal,
      tangent: stats.tangent,
      color: { maxRgbDistance: stats.color.maxRgbDistance },
      aabb: {
        inside: stats.aabb.inside,
        overshoot: stats.aabb.overshoot,
      },
      frameOrthonormalError: frameErr,
      bboxDiagonal: stats.bboxDiagonal,
    };
    report.meshes.push(entry);

    const tag = `${mesh.name}/${mode}`;
    check(`${tag} aabb`, stats.aabb.inside,
      `overshoot ${JSON.stringify(stats.aabb.overshoot)}`);
    check(`${tag} normal unit length`,
      stats.normal.maxLengthError <= normalLengthLimit[mode],
      `${stats.normal.maxLengthError} > ${normalLengthLimit[mode]}`);
    check(`${tag} frame orthonormal`, frameErr <= frameLimit,
      `${frameErr} > ${frameLimit}`);
    check(`${tag} handedness preserved`,
      stats.tangent.handednessMismatches === 0,
      `${stats.tangent.handednessMismatches} mismatches`);
    check(`${tag} uv finite`, Number.isFinite(stats.uv.maxAbs), 'uv error NaN');
  }
}

// UV seam boundary: duplicated seam vertices must keep exact 0/1 UVs.
{
  const seam = makeUvSeamQuad();
  const packed = compressMesh(seam, { mode: 'oct16' });
  const decoded = decompressMesh(seam, packed);
  const u = decoded.uvs;
  const boundaryOK =
    u[2 * 4] === 0 && u[2 * 4 + 1] === 0 &&
    u[2 * 5] === 1 && u[2 * 5 + 1] === 1;
  check('uv seam 0/1 preserved', boundaryOK,
    `v4=${u.slice(8, 10).join(',')} v5=${u.slice(10, 12).join(',')}`);
  report.uvSeam = {
    decodedSeamVertices: [
      Array.from(u.slice(8, 10)),
      Array.from(u.slice(10, 12)),
    ],
    boundaryOK,
  };
}

// Sliver triangle: thin axis (thickness=1e-4) must stay distinguishable.
{
  const sliver = makeSlivers();
  const packed = compressMesh(sliver, { mode: 'oct16' });
  const decoded = decompressMesh(sliver, packed);
  const yMin = Math.min(...decoded.positions.filter((_, i) => i % 3 === 1));
  const yMax = Math.max(...decoded.positions.filter((_, i) => i % 3 === 1));
  const thinSpan = yMax - yMin;
  report.sliver = { decodedThinAxisSpan: thinSpan, sourceThickness: 1e-4 };
  check('sliver thin axis non-degenerate', thinSpan > 0,
    `span collapsed to ${thinSpan}`);
}

mkdirSync(join(root, 'artifacts'), { recursive: true });
writeFileSync(join(root, 'artifacts', 'compression-report.json'),
  JSON.stringify(report, null, 2));

printTable(report);
if (failures.length) {
  console.error('\nFAILURES:');
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log('\nAll checks passed. Report: artifacts/compression-report.json');

function printTable(r) {
  const hdr = 'mesh/mode'.padEnd(22) +
    'posMax'.padStart(11) + 'posRel'.padStart(10) +
    'nrmLen'.padStart(10) + 'nrmDeg'.padStart(9) +
    'tanDeg'.padStart(8) + 'colMax'.padStart(9) +
    'srcB'.padStart(8) + 'cmpB'.padStart(8) + 'ratio'.padStart(7);
  console.log(hdr);
  for (const e of r.meshes) {
    console.log(
      `${e.mesh + '/' + e.mode}`.padEnd(22) +
      e.position.maxAbs.toExponential(2).padStart(11) +
      e.position.maxRelative.toExponential(1).padStart(10) +
      e.normal.maxLengthError.toExponential(1).padStart(10) +
      e.normal.maxAngleDeg.toFixed(3).padStart(9) +
      e.tangent.maxAngleDeg.toFixed(2).padStart(8) +
      e.color.maxRgbDistance.toExponential(1).padStart(9) +
      String(e.bytes.source).padStart(8) +
      String(e.bytes.compressed).padStart(8) +
      e.bytes.ratio.toFixed(2).padStart(7)
    );
  }
}
