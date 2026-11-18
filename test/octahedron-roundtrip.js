// Property test: octahedral round-trip over uniformly distributed vectors.
import {
  oct16Encode, oct16Decode, oct32Encode, oct32Decode, octEncode, octDecodeRaw,
} from '../src/octahedron.js';

let seed = 123456789;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function angle(a, b) {
  const c = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(c) * 180) / Math.PI;
}

const limit = { oct16: 1.2, oct32: 0.01 };
const worst = { float: 0, oct16: 0, oct32: 0 };
const N = 100000;
for (let i = 0; i < N; i++) {
  let v = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
  const l = Math.hypot(...v);
  v = v.map((x) => x / l);
  const [ex, ey] = octEncode(v);
  worst.float = Math.max(worst.float, angle(v, octDecodeRaw(ex, ey)));
  const a16 = angle(v, oct16Decode(oct16Encode(v)));
  worst.oct16 = Math.max(worst.oct16, a16);
  worst.oct32 = Math.max(worst.oct32, angle(v, oct32Decode(oct32Encode(v))));
}

console.log('worst angles over', N, 'random unit vectors:');
console.log('  float fold :', worst.float.toFixed(4), 'deg');
console.log('  oct16      :', worst.oct16.toFixed(4), 'deg (limit', limit.oct16 + ')');
console.log('  oct32      :', worst.oct32.toFixed(4), 'deg (limit', limit.oct32 + ')');

const fail = [];
if (worst.float > 1e-3) fail.push(`float round-trip ${worst.float}`);
if (worst.oct16 > limit.oct16) fail.push(`oct16 ${worst.oct16}`);
if (worst.oct32 > limit.oct32) fail.push(`oct32 ${worst.oct32}`);
if (fail.length) { console.error('FAIL', fail); process.exit(1); }
console.log('octahedron round-trip OK');
