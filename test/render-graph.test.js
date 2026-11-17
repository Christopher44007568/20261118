import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RenderGraph, RenderGraphError } from '../src/render-graph.js';
import { createDemoGraph, setFogEnabled, RENDER_WIDTH, RENDER_HEIGHT } from '../src/demo-graph.js';

test('sorts and reuses textures for a stable normal render chain', () => {
  const demo = createDemoGraph();

  const first = demo.graph.execute();
  const second = demo.graph.execute();

  assert.deepEqual(first.order, [
    'shadow',
    'mainScene',
    'volumetricFog',
    'tonemap'
  ]);
  assert.deepEqual(second.order, first.order);
  assert.equal(second.output, first.output);
  assert.deepEqual(demo.calls, [
    'shadow',
    'mainScene',
    'volumetricFog',
    'tonemap',
    'shadow',
    'mainScene',
    'volumetricFog',
    'tonemap'
  ]);

  const expectedTextures = [
    'shadowMap',
    'sceneColor',
    'fogColor',
    'finalColor'
  ];
  assert.deepEqual(
    [...demo.graph.allocator.textures.keys()],
    expectedTextures
  );
  assert.equal(demo.graph.allocator.textures.size, expectedTextures.length);
  assert.equal(demo.device.liveTextureCount, expectedTextures.length + 1);
});

test('detects a mismatched input texture format before executing a pass', () => {
  const demo = createDemoGraph();
  demo.graph.setInputFormat('volumetricFog', 'sceneColor', 'rgba32float');

  assert.throws(
    () => demo.graph.execute(),
    (error) =>
      error instanceof RenderGraphError &&
      error.message.includes('Format mismatch for volumetricFog.sceneColor') &&
      error.message.includes('expected rgba32float') &&
      error.message.includes('provides rgba16float')
  );
  assert.deepEqual(demo.calls, []);
  assert.equal(demo.device.liveTextureCount, 1);
});

test('rejects a cyclic dependency before allocating graph textures', () => {
  const demo = createDemoGraph();
  const fog = demo.graph.getPass('volumetricFog');
  const tonemap = demo.graph.getPass('tonemap');

  fog.dependencies.push('tonemap');
  tonemap.dependencies.push('volumetricFog');

  assert.throws(
    () => demo.graph.execute(),
    (error) =>
      error instanceof RenderGraphError &&
      error.message.includes('Cyclic pass dependency detected')
  );
  assert.deepEqual(demo.calls, []);
  assert.equal(demo.device.liveTextureCount, 1);
  assert.equal(demo.graph.allocator.textures.size, 0);
});

test('releases fog output and lowers both peak memory and texture count', () => {
  const demo = createDemoGraph();
  demo.graph.execute();

  const withFogPeakBytes = demo.device.peakBytes;
  const withFogPeakTextures = demo.device.peakTextureCount;
  const fogTexture = demo.graph.getTexture('fogColor');

  setFogEnabled(demo, false);
  const result = demo.graph.execute();

  assert.deepEqual(result.order, ['shadow', 'mainScene', 'tonemap']);
  assert.equal(result.output.format, 'rgba8unorm');
  assert.equal(fogTexture.destroyed, true);
  assert.equal(demo.graph.allocator.has('fogColor'), false);
  assert.equal(demo.graph.allocator.textures.size, 3);
  assert.equal(demo.device.liveTextureCount, 4);
  assert.equal(
    demo.device.peakTextureCount,
    withFogPeakTextures - 1
  );

  const fogBytes = RENDER_WIDTH * RENDER_HEIGHT * 8;
  assert.equal(
    withFogPeakBytes - demo.device.peakBytes,
    fogBytes
  );
  assert.equal(demo.device.peakBytes, 5 * 1024 * 1024);
  assert.equal(demo.graph.allocator.peakBytes, 4 * 1024 * 1024);
});

test('accepts a valid user-selected input texture format', () => {
  const demo = createDemoGraph();
  demo.graph.setInputFormat('mainScene', 'environmentMap', 'rgba8unorm');

  const result = demo.graph.execute();

  assert.equal(result.output.format, 'rgba8unorm');
  assert.deepEqual(demo.calls, [
    'shadow',
    'mainScene',
    'volumetricFog',
    'tonemap'
  ]);
});

test('reallocates a released output when a disabled pass is enabled again', () => {
  const demo = createDemoGraph();
  demo.graph.execute();
  const originalFogTexture = demo.graph.getTexture('fogColor');

  setFogEnabled(demo, false);
  demo.graph.execute();
  setFogEnabled(demo, true);
  const result = demo.graph.execute();

  assert.deepEqual(result.order, [
    'shadow',
    'mainScene',
    'volumetricFog',
    'tonemap'
  ]);
  assert.equal(originalFogTexture.destroyed, true);
  assert.notEqual(demo.graph.getTexture('fogColor'), originalFogTexture);
  assert.equal(demo.graph.allocator.textures.size, 4);
});

test('disposes graph-owned textures without destroying external input textures', () => {
  const demo = createDemoGraph();
  demo.graph.execute();
  const environmentMap = demo.graph.getTexture('environmentMap');

  demo.graph.dispose();

  assert.equal(demo.graph.allocator.textures.size, 0);
  assert.equal(demo.graph.allocator.currentBytes, 0);
  assert.equal(environmentMap.destroyed, false);
});

test('rejects a pass whose explicit dependency is disabled', () => {
  const demo = createDemoGraph();
  demo.graph.getPass('tonemap').dependencies.push('volumetricFog');
  demo.graph.setPassEnabled('volumetricFog', false);

  assert.throws(
    () => demo.graph.execute(),
    /Pass tonemap depends on disabled or unknown pass volumetricFog/
  );
});

test('keeps explicit pass dependencies and inferred resource dependencies consistent', () => {
  const graph = new RenderGraph(new MockDeviceWithFormat());
  graph.registerExternalTexture('input', { id: 'input', format: 'rgba8unorm' });
  graph.addPass({
    name: 'producer',
    inputs: [{ name: 'input', resource: 'input', format: 'rgba8unorm' }],
    outputs: [
      {
        name: 'color',
        resource: 'color',
        descriptor: textureDescriptor('rgba16float')
      }
    ],
    execute: () => {}
  });
  graph.addPass({
    name: 'consumer',
    dependencies: ['producer'],
    inputs: [{ name: 'color', resource: 'color', format: 'rgba16float' }],
    outputs: [
      {
        name: 'final',
        resource: 'final',
        descriptor: textureDescriptor('rgba8unorm')
      }
    ],
    execute: () => {}
  });

  assert.deepEqual(graph.compile().order, ['producer', 'consumer']);
});

function textureDescriptor(format) {
  return {
    size: [2, 2, 1],
    format,
    usage: 0
  };
}

class MockDeviceWithFormat {
  createTexture(descriptor) {
    return {
      format: descriptor.format,
      destroyed: false,
      destroy() {
        this.destroyed = true;
      }
    };
  }

  get currentBytes() {
    return 0;
  }

  get peakBytes() {
    return 0;
  }

  set peakBytes(_value) {}

  get peakTextureCount() {
    return 0;
  }

  set peakTextureCount(_value) {}
}
