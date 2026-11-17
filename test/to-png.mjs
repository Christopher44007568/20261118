// Minimal PPM (P6) -> PNG converter using only Node built-ins.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function ppmToPng(ppmPath, pngPath) {
  const raw = readFileSync(ppmPath);
  let pos = 0;
  const readToken = () => {
    while (raw[pos] === 0x20 || raw[pos] === 0x0a || raw[pos] === 0x09) pos++;
    const start = pos;
    while (raw[pos] > 0x20) pos++;
    return raw.subarray(start, pos).toString();
  };
  if (readToken() !== 'P6') throw new Error('not P6');
  const w = Number(readToken()), h = Number(readToken()), max = Number(readToken());
  pos++; // single whitespace after maxval
  const rgb = raw.subarray(pos);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const stride = w * 3;
  const withFilter = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    withFilter[y * (stride + 1)] = 0;
    rgb.copy(withFilter, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(withFilter)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(pngPath, png);
}

const dir = 'test/screenshots';
for (const f of readdirSync(dir).filter((x) => x.endsWith('.ppm'))) {
  ppmToPng(`${dir}/${f}`, `${dir}/${f.replace('.ppm', '.png')}`);
}
console.log('converted');
