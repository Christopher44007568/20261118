// Minimal dependency-free PNG encoder (8-bit RGB) using Node's zlib.
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// pixels: Uint8Array of width*height*3 (RGB, top-to-bottom rows)
function encodePNG(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Simple RGB image container with tone mapping helpers.
class Image {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Float64Array(width * height * 3); // linear HDR
  }
  set(x, y, rgb) {
    const i = (y * this.width + x) * 3;
    this.data[i] = rgb[0]; this.data[i + 1] = rgb[1]; this.data[i + 2] = rgb[2];
  }
  get(x, y) {
    const i = (y * this.width + x) * 3;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  // ACES-ish filmic curve + gamma, returns 8-bit buffer
  toBytes(exposure = 1.0) {
    const out = new Uint8Array(this.width * this.height * 3);
    const aces = (x) => {
      x *= exposure;
      const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (c * x + d) + e)));
    };
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.round(Math.pow(aces(this.data[i]), 1 / 2.2) * 255);
    }
    return out;
  }
  toPNG(exposure = 1.0) {
    return encodePNG(this.width, this.height, this.toBytes(exposure));
  }
}

module.exports = { encodePNG, Image };
