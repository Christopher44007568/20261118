// Demo renderer with five profiled passes per frame:
//   shadow - depth-only cube grid from the light's POV
//   scene  - lit, shadow-mapped cube grid into an offscreen color target
//   post   - deliberately heavy fullscreen blur onto the canvas
//   ui     - instanced overlay bars visualizing the latest per-pass stats
//   empty  - a pass with zero draws, used to validate attribution (~0 ms)

import { perspective, lookAt, multiply } from './mat4.js';
import { shadowShader, sceneShader, postShader, uiShader } from './shaders.js';

export const PASS_NAMES = ['shadow', 'scene', 'post', 'ui', 'empty'];

const CUBE_COUNT = 64;
const SHADOW_SIZE = 1024;
const BAR_COLORS = [
  [1.0, 0.85, 0.2, 0.85], // shadow
  [0.3, 0.9, 0.4, 0.85],  // scene
  [0.95, 0.3, 0.3, 0.85], // post
  [0.3, 0.8, 0.95, 0.85], // ui
  [0.6, 0.6, 0.6, 0.85],  // empty
];

function cubeGeometry() {
  // 24 vertices (pos xyz, normal xyz), 36 indices
  const p = 0.5;
  const faces = [
    [[0, 0, 1], [[-p, -p, p], [p, -p, p], [p, p, p], [-p, p, p]]],
    [[0, 0, -1], [[p, -p, -p], [-p, -p, -p], [-p, p, -p], [p, p, -p]]],
    [[1, 0, 0], [[p, -p, p], [p, -p, -p], [p, p, -p], [p, p, p]]],
    [[-1, 0, 0], [[-p, -p, -p], [-p, -p, p], [-p, p, p], [-p, p, -p]]],
    [[0, 1, 0], [[-p, p, p], [p, p, p], [p, p, -p], [-p, p, -p]]],
    [[0, -1, 0], [[-p, -p, -p], [p, -p, -p], [p, -p, p], [-p, -p, p]]],
  ];
  const verts = [];
  const indices = [];
  for (const [normal, corners] of faces) {
    const base = verts.length / 6;
    for (const c of corners) verts.push(...c, ...normal);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { verts: new Float32Array(verts), indices: new Uint16Array(indices) };
}

export class Renderer {
  constructor({ device, context, canvasFormat, profiler }) {
    this.device = device;
    this.context = context;
    this.canvasFormat = canvasFormat;
    this.profiler = profiler;

    const geo = cubeGeometry();
    this.vertexBuffer = device.createBuffer({
      size: geo.verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, geo.verts);
    this.indexBuffer = device.createBuffer({
      size: geo.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuffer, 0, geo.indices);

    this.uniformBuffer = device.createBuffer({
      size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.barBuffer = device.createBuffer({
      size: PASS_NAMES.length * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.shadowTexture = device.createTexture({
      size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shadowView = this.shadowTexture.createView();

    this.sceneColorTexture = null; // created on resize
    this.sceneDepthTexture = null;
    this.width = 0;
    this.height = 0;

    this._createPipelines();
    this._createBindGroups();
  }

  _createPipelines() {
    const device = this.device;
    const vertexBuffers = [{
      arrayStride: 24,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
      ],
    }];

    this.uniformLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    this.shadowSamplerLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    this.postLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.uiLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
    });

    const shadowModule = device.createShaderModule({ code: shadowShader });
    const sceneModule = device.createShaderModule({ code: sceneShader });
    const postModule = device.createShaderModule({ code: postShader });
    const uiModule = device.createShaderModule({ code: uiShader });

    this.shadowPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.uniformLayout] }),
      vertex: { module: shadowModule, entryPoint: 'vs', buffers: vertexBuffers },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
    });

    this.scenePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.uniformLayout, this.shadowSamplerLayout] }),
      vertex: { module: sceneModule, entryPoint: 'vs', buffers: vertexBuffers },
      fragment: { module: sceneModule, entryPoint: 'fs', targets: [{ format: this.canvasFormat }] },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
    });

    this.postPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.postLayout] }),
      vertex: { module: postModule, entryPoint: 'vs' },
      fragment: { module: postModule, entryPoint: 'fs', targets: [{ format: this.canvasFormat }] },
      primitive: { topology: 'triangle-list' },
    });

    this.uiPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.uiLayout] }),
      vertex: { module: uiModule, entryPoint: 'vs' },
      fragment: {
        module: uiModule, entryPoint: 'fs',
        targets: [{
          format: this.canvasFormat,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  _createBindGroups() {
    this.uniformBindGroup = this.device.createBindGroup({
      layout: this.uniformLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.shadowBindGroup = this.device.createBindGroup({
      layout: this.shadowSamplerLayout,
      entries: [
        { binding: 0, resource: this.shadowView },
        { binding: 1, resource: this.device.createSampler({ compare: 'less-equal' }) },
      ],
    });
    this.uiBindGroup = this.device.createBindGroup({
      layout: this.uiLayout,
      entries: [{ binding: 0, resource: { buffer: this.barBuffer } }],
    });
    this.postSampler = this.device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
    });
    this.postBindGroup = null; // depends on scene color texture
  }

  _resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    for (const key of ['sceneColorTexture', 'sceneDepthTexture']) {
      if (this[key]) this[key].destroy();
    }
    this.sceneColorTexture = this.device.createTexture({
      size: [width, height], format: this.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.sceneDepthTexture = this.device.createTexture({
      size: [width, height], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.sceneColorView = this.sceneColorTexture.createView();
    this.sceneDepthView = this.sceneDepthTexture.createView();
    this.postBindGroup = this.device.createBindGroup({
      layout: this.postLayout,
      entries: [
        { binding: 0, resource: this.sceneColorView },
        { binding: 1, resource: this.postSampler },
      ],
    });
  }

  _updateUniforms(time) {
    const aspect = this.width / Math.max(1, this.height);
    const cameraVP = multiply(
      perspective(Math.PI / 4, aspect, 0.1, 100),
      lookAt([0, 14, 22], [0, 0, 0], [0, 1, 0]),
    );
    const lightVP = multiply(
      perspective(Math.PI / 3, 1, 1, 60),
      lookAt([6, 10, 4], [0, 0, 0], [0, 1, 0]),
    );
    const data = new Float32Array(36);
    data.set(cameraVP, 0);
    data.set(lightVP, 16);
    data[32] = time;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  _updateBars() {
    const snapshot = this.profiler.stats.snapshot();
    const data = new Float32Array(PASS_NAMES.length * 8);
    PASS_NAMES.forEach((name, i) => {
      const mean = snapshot[name]?.mean ?? 0;
      const width = Math.min(0.36, Math.max(0.005, mean * 0.04));
      data.set([
        -0.98 + i * 0.4, -0.95, // origin (ndc)
        width, 0.06,            // size
        ...BAR_COLORS[i],
      ], i * 8);
    });
    this.device.queue.writeBuffer(this.barBuffer, 0, data);
  }

  // Encodes and submits one frame. Returns false when the profiler asked us
  // to skip (paused, or readback pool exhausted) so nothing is submitted and
  // no sample can be double-counted.
  frame(timeMs) {
    if (!this.profiler.beginFrame()) return false;
    const canvas = this.context.canvas;
    this._resize(canvas.width, canvas.height);
    this._updateUniforms(timeMs / 1000);
    this._updateBars();

    const encoder = this.device.createCommandEncoder();
    const profiler = this.profiler;

    const shadowPass = encoder.beginRenderPass(profiler.wrapPassDescriptor('shadow', {
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    }));
    shadowPass.setPipeline(this.shadowPipeline);
    shadowPass.setBindGroup(0, this.uniformBindGroup);
    shadowPass.setVertexBuffer(0, this.vertexBuffer);
    shadowPass.setIndexBuffer(this.indexBuffer, 'uint16');
    shadowPass.drawIndexed(36, CUBE_COUNT);
    shadowPass.end();
    profiler.endPass('shadow');

    const scenePass = encoder.beginRenderPass(profiler.wrapPassDescriptor('scene', {
      colorAttachments: [{
        view: this.sceneColorView,
        clearValue: { r: 0.05, g: 0.06, b: 0.09, a: 1 }, loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.sceneDepthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard',
      },
    }));
    scenePass.setPipeline(this.scenePipeline);
    scenePass.setBindGroup(0, this.uniformBindGroup);
    scenePass.setBindGroup(1, this.shadowBindGroup);
    scenePass.setVertexBuffer(0, this.vertexBuffer);
    scenePass.setIndexBuffer(this.indexBuffer, 'uint16');
    scenePass.drawIndexed(36, CUBE_COUNT);
    scenePass.end();
    profiler.endPass('scene');

    const canvasView = this.context.getCurrentTexture().createView();

    const postPass = encoder.beginRenderPass(profiler.wrapPassDescriptor('post', {
      colorAttachments: [{
        view: canvasView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store',
      }],
    }));
    postPass.setPipeline(this.postPipeline);
    postPass.setBindGroup(0, this.postBindGroup);
    postPass.draw(3);
    postPass.end();
    profiler.endPass('post');

    const uiPass = encoder.beginRenderPass(profiler.wrapPassDescriptor('ui', {
      colorAttachments: [{ view: canvasView, loadOp: 'load', storeOp: 'store' }],
    }));
    uiPass.setPipeline(this.uiPipeline);
    uiPass.setBindGroup(0, this.uiBindGroup);
    uiPass.draw(6, PASS_NAMES.length);
    uiPass.end();
    profiler.endPass('ui');

    // Validation pass: timestamps around a pass that issues no draws at all.
    const emptyPass = encoder.beginRenderPass(profiler.wrapPassDescriptor('empty', {
      colorAttachments: [{ view: canvasView, loadOp: 'load', storeOp: 'store' }],
    }));
    emptyPass.end();
    profiler.endPass('empty');

    profiler.finishFrame(encoder);
    this.device.queue.submit([encoder.finish()]);
    profiler.poll(); // async readback, recorded exactly once per frame
    return true;
  }
}
