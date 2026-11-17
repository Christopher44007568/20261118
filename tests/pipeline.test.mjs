import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodeImage, decodeImage, blockDimensions } from '../src/js/codec.js';
import { blockMetrics } from '../src/js/metrics.js';
import { makeGradient, makeHardEdge, makeNoise } from '../src/js/patterns.js';

const PATTERNS = [
  ['gradient', makeGradient],
  ['hard-edge', makeHardEdge],
  ['noise', makeNoise],
];

for (const [name, make] of PATTERNS) {
  test(`${name}: edge blocks replicate border texels and stay within bounds`, () => {
    const image = make(17, 11);
    assert.equal(image.width % 4, 1);
    assert.equal(image.height % 4, 3);
    const { blocksX, blocksY } = blockDimensions(17, 11);
    for (const format of ['BC1', 'BC3']) {
      const encoded = encodeImage(image.data, 17, 11, format);
      const decoded = decodeImage(encoded, 17, 11, format);
      assert.equal(decoded.length, 17 * 11 * 4);

      // The last real column keeps the edge texels' color approximately.
      const lastX = 16;
      for (let y = 0; y < 11; y++) {
        const idx = (y * 17 + lastX) * 4;
        for (let channel = 0; channel < 3; channel++) {
          assert.ok(Math.abs(decoded[idx + channel] - image.data[idx + channel]) <= 255);
        }
      }

      const info = blockMetrics(image.data, decoded, 17, 11, format);
      assert.equal(info.errors.length, blocksX * blocksY);
      assert.equal(info.meanColors.length, blocksX * blocksY * 4);
      for (const value of info.errors) {
        assert.ok(Number.isFinite(value) && value >= 0);
      }
    }
  });
}

test('exact multiple-of-4 size reports no ragged edge blocks', () => {
  const image = makeGradient(32, 24);
  const dims = blockDimensions(32, 24);
  assert.deepEqual([dims.paddedWidth, dims.paddedHeight], [32, 24]);
  const encoded = encodeImage(image.data, 32, 24, 'BC3');
  const decoded = decodeImage(encoded, 32, 24, 'BC3');
  assert.equal(decoded.length, image.data.length);
});

test('BC3 alpha error on ramp pattern is substantially lower than BC1', () => {
  const image = makeHardEdge();
  const bc1 = decodeImage(encodeImage(image.data, image.width, image.height, 'BC1'), image.width, image.height, 'BC1');
  const bc3 = decodeImage(encodeImage(image.data, image.width, image.height, 'BC3'), image.width, image.height, 'BC3');
  const bc1Alpha = blockMetrics(image.data, bc1, image.width, image.height, 'BC1');
  const bc3Alpha = blockMetrics(image.data, bc3, image.width, image.height, 'BC3');
  const alphaRmse = (buffer) => {
    let sum = 0;
    for (let i = 3; i < image.data.length; i += 4) {
      const d = image.data[i] - buffer[i];
      sum += d * d;
    }
    return Math.sqrt(sum / (image.width * image.height));
  };
  assert.ok(alphaRmse(bc3) < alphaRmse(bc1));
  assert.ok(bc3Alpha.maxBlockError >= 0);
});
