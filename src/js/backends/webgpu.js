// WebGPU decoding backend.
// Uploads the BC bytes into a compressed texture, copies into a readable
// RGBA8 texture and reads the staging buffer back. Requires the matching
// texture-compression-bc feature for native decoding; without it the caller
// falls back to the CPU path.

import { FORMATS, blockDimensions } from '../codec.js';

export async function isAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

export async function capabilities() {
  if (!(await isAvailable())) {
    return { available: false, nativeBC: false, formats: [], timestamp: false };
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { available: false, nativeBC: false, formats: [], timestamp: false };
  const nativeBC = adapter.features.has('texture-compression-bc');
  const timestamp = adapter.features.has('timestamp-query');
  return {
    available: true,
    nativeBC,
    timestamp,
    formats: nativeBC ? Object.keys(FORMATS).map((name) => ({ name, native: true })) : [],
    adapter: adapter.info ? `${adapter.info.vendor} ${adapter.info.architecture}`.trim() : 'unknown',
  };
}

function bytesPerRow(width) {
  // WebGPU requires COPY_BYTES_PER_ROW_ALIGNMENT = 256.
  return Math.ceil((width * 4) / 256) * 256;
}

const SHADER = `
override paddedWidth: f32;
override paddedHeight: f32;
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  // Integer texel coordinate -> texel-center UV so NEAREST sampling never
  // drifts onto a neighboring block-border texel.
  let texel = vec2<i32>(position.xy);
  let uv = (vec2<f32>(texel) + vec2f(0.5, 0.5)) / vec2f(paddedWidth, paddedHeight);
  return textureSample(sourceTexture, sourceSampler, uv);
}`;

export async function decodeWebGPU(blocks, width, height, format) {
  if (!(await isAvailable())) throw new Error('当前环境不支持 WebGPU');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('无法获取 WebGPU adapter');
  if (!adapter.features.has('texture-compression-bc')) {
    throw new Error('WebGPU adapter 缺少 texture-compression-bc 特性');
  }
  const timestampSupported = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: timestampSupported
      ? ['texture-compression-bc', 'timestamp-query']
      : ['texture-compression-bc'],
  });

  const startTime = performance.now();
  const compressedFormat = FORMATS[format].wgpu;
  const { paddedWidth, paddedHeight } = blockDimensions(width, height);
  const sourceTexture = device.createTexture({
    size: [paddedWidth, paddedHeight],
    format: compressedFormat,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  });
  device.queue.writeTexture(
    { texture: sourceTexture },
    blocks,
    {
      bytesPerRow: Math.ceil(width / 4) * FORMATS[format].bytesPerBlock,
      rowsPerImage: Math.ceil(height / 4),
    },
    [paddedWidth, paddedHeight],
  );

  const outputTexture = device.createTexture({
    size: [paddedWidth, paddedHeight],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  const sampler = device.createSampler({
    magFilter: 'nearest',
    minFilter: 'nearest',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: sourceTexture.createView() },
      { binding: 1, resource: sampler },
    ],
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: device.createShaderModule({ code: SHADER }),
      entryPoint: 'vertexMain',
      constants: { paddedWidth, paddedHeight },
    },
    fragment: {
      module: device.createShaderModule({ code: SHADER }),
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba8unorm' }],
      constants: { paddedWidth, paddedHeight },
    },
    primitive: { topology: 'triangle-list' },
  });

  const encoder = device.createCommandEncoder();
  let querySet;
  let queryBuffer;
  if (timestampSupported) {
    querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
    queryBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    encoder.writeTimestamp(querySet, 0);
  }
  const renderPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: outputTexture.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  renderPass.setPipeline(pipeline);
  renderPass.setBindGroup(0, bindGroup);
  renderPass.draw(3);
  renderPass.end();
  if (timestampSupported) encoder.writeTimestamp(querySet, 1);

  const rowPitch = bytesPerRow(paddedWidth);
  const stagingBuffer = device.createBuffer({
    size: rowPitch * paddedHeight,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  encoder.copyTextureToBuffer(
    { texture: outputTexture },
    { buffer: stagingBuffer, bytesPerRow: rowPitch },
    [paddedWidth, paddedHeight],
  );
  if (timestampSupported) encoder.resolveQuerySet(querySet, 0, 2, queryBuffer, 0);
  const commands = encoder.finish();
  device.queue.submit([commands]);

  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const wallElapsedMs = performance.now() - startTime;
  const mapped = stagingBuffer.getMappedRange();
  const padded = new Uint8Array(mapped);
  const output = new Uint8ClampedArray(width * height * 4);
  // Render output is top-left origin and already in image order; only crop the
  // padded columns and drop the padded bottom rows.
  for (let row = 0; row < height; row++) {
    const sourceStart = row * rowPitch;
    output.set(
      padded.subarray(sourceStart, sourceStart + width * 4),
      row * width * 4,
    );
  }
  stagingBuffer.unmap();

  let gpuElapsedMs = null;
  if (timestampSupported) {
    await queryBuffer.mapAsync(GPUMapMode.READ);
    const timestamps = new BigUint64Array(queryBuffer.getMappedRange());
    gpuElapsedMs = Number(timestamps[1] - timestamps[0]) / 1e6;
    queryBuffer.unmap();
  }

  sourceTexture.destroy();
  outputTexture.destroy();
  stagingBuffer.destroy();
  device.destroy();

  return {
    data: output,
    width,
    height,
    elapsedMs: gpuElapsedMs ?? wallElapsedMs,
    wallElapsedMs,
    gpuElapsedMs,
    mode: 'gpu-native',
    uploadBytes: blocks.byteLength,
    compressedBytes: blocks.byteLength,
    backend: 'WebGPU',
  };
}
