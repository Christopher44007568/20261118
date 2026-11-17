import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodeBC1Block, decodeBC1Block, encodeRGB565, decodeRGB565 } from '../src/js/bc1.js';
import { encodeBC3Block, decodeBC3Block } from '../src/js/bc3.js';
import { encodeImage, decodeImage, compressedByteSize, blockDimensions, FORMATS } from '../src/js/codec.js';
import { makeGradient, makeHardEdge, makeNoise } from '../src/js/patterns.js';
import { globalMetrics } from '../src/js/metrics.js';

test('RGB565 round trip for primary colors', () => {
  for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255]]) {
    const decoded = decodeRGB565(encodeRGB565(r, g, b));
    assert.ok(Math.abs(decoded[0] - r) <= 8);
    assert.ok(Math.abs(decoded[1] - g) <= 4);
    assert.ok(Math.abs(decoded[2] - b) <= 8);
  }
});

test('BC1 solid color block decodes to near-identical pixels', () => {
  const pixels = new Uint8ClampedArray(64);
  for (let i = 0; i < 16; i++) {
    pixels[i * 4] = 200;
    pixels[i * 4 + 1] = 100;
    pixels[i * 4 + 2] = 50;
    pixels[i * 4 + 3] = 255;
  }
  const block = encodeBC1Block(pixels);
  assert.equal(block.length, 8);
  const decoded = decodeBC1Block(block);
  for (let i = 0; i < 16; i++) {
    assert.ok(Math.abs(decoded[i * 4] - 200) <= 8);
    assert.ok(Math.abs(decoded[i * 4 + 1] - 100) <= 4);
    assert.ok(Math.abs(decoded[i * 4 + 2] - 50) <= 8);
    assert.equal(decoded[i * 4 + 3], 255);
  }
});

test('BC3 preserves opaque and transparent alpha extremes', () => {
  const pixels = new Uint8ClampedArray(64);
  for (let i = 0; i < 16; i++) {
    pixels[i * 4] = 30;
    pixels[i * 4 + 1] = 60;
    pixels[i * 4 + 2] = 90;
    pixels[i * 4 + 3] = i % 2 === 0 ? 0 : 255;
  }
  const block = encodeBC3Block(pixels);
  assert.equal(block.length, 16);
  const decoded = decodeBC3Block(block);
  for (let i = 0; i < 16; i++) {
    const expected = pixels[i * 4 + 3];
    // Endpoint indices 0/1 reproduce 255/0 exactly under nearest matching.
    assert.equal(decoded[i * 4 + 3], expected, `alpha ${i}`);
  }
});

test('BC3 mid-range alpha is reproduced within quantizer tolerance', () => {
  const pixels = new Uint8ClampedArray(64);
  for (let i = 0; i < 16; i++) {
    pixels[i * 4] = 10;
    pixels[i * 4 + 1] = 20;
    pixels[i * 4 + 2] = 30;
    pixels[i * 4 + 3] = 128;
  }
  const decoded = decodeBC3Block(encodeBC3Block(pixels));
  for (let i = 0; i < 16; i++) {
    assert.ok(Math.abs(decoded[i * 4 + 3] - 128) <= 19, '8-entry alpha step tolerance');
  }
});

test('edge-block dimensions for non-multiple-of-4 sizes', () => {
  const dims = blockDimensions(30, 22);
  assert.deepEqual(dims, { blocksX: 8, blocksY: 6, paddedWidth: 32, paddedHeight: 24 });
  assert.equal(compressedByteSize(30, 22, 'BC1'), 8 * 6 * 8);
  assert.equal(compressedByteSize(30, 22, 'BC3'), 8 * 6 * 16);
});

test('full image round trip preserves dimensions for every pattern and format', () => {
  for (const make of [makeGradient, makeHardEdge, makeNoise]) {
    const image = make();
    for (const format of Object.keys(FORMATS)) {
      const encoded = encodeImage(image.data, image.width, image.height, format);
      assert.equal(encoded.length, compressedByteSize(image.width, image.height, format));
      const decoded = decodeImage(encoded, image.width, image.height, format);
      assert.equal(decoded.length, image.data.length);
      const metrics = globalMetrics(image.data, decoded, image.width, image.height);
      assert.ok(metrics.rmse.rgb < 80, `${image.name} ${format} rmse sanity`);
      assert.ok(metrics.maxError <= 255);
    }
  }
});

test('hard edges compress with lower error than random noise', () => {
  const edgeImage = makeHardEdge();
  const noiseImage = makeNoise();
  const edgeEncoded = encodeImage(edgeImage.data, edgeImage.width, edgeImage.height, 'BC1');
  const noiseEncoded = encodeImage(noiseImage.data, noiseImage.width, noiseImage.height, 'BC1');
  const edgeError = globalMetrics(edgeImage.data, decodeImage(edgeEncoded, 30, 22, 'BC1'), 30, 22);
  const noiseError = globalMetrics(noiseImage.data, decodeImage(noiseEncoded, 30, 22, 'BC1'), 30, 22);
  assert.ok(edgeError.rmse.rgb < noiseError.rmse.rgb);
});
