// WebGPU 渲染器：可见画面 + 整数 ID 拾取通道
// 两个通道共享同一相机 uniform、同一深度格式与裁剪规则（同一顶点 shader 与管线状态）

import { createCubeVertexData } from './scene.js';

const CAMERA_FLOATS = 16 + 4;

const VERT = /* wgsl */ `
struct Camera {
  viewProj : mat4x4f,
  selected : vec4u,
};
@group(0) @binding(0) var<uniform> cam : Camera;

struct ObjMeta { objectId : u32, pad0 : u32, pad1 : u32, pad2 : u32 };
@group(1) @binding(0) var<uniform> obj : ObjMeta;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) normal : vec3f,
  @location(1) color : vec4f,
  @location(2) @interpolate(flat) instId : u32,
};

@vertex fn vsMain(
  @location(0) position : vec3f,
  @location(1) normal : vec3f,
  @location(3) m0 : vec4f,
  @location(4) m1 : vec4f,
  @location(5) m2 : vec4f,
  @location(6) m3 : vec4f,
  @location(7) color : vec4f,
  @builtin(instance_index) instIdx : u32,
) -> VsOut {
  let model = mat4x4f(m0, m1, m2, m3);
  var out : VsOut;
  let world = model * vec4f(position, 1.0);
  out.pos = cam.viewProj * world;
  out.normal = (model * vec4f(normal, 0.0)).xyz;
  out.color = color;
  out.instId = instIdx;
  return out;
}
`;

const FRAG_COLOR = /* wgsl */ `
struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) normal : vec3f,
  @location(1) color : vec4f,
  @location(2) @interpolate(flat) instId : u32,
};
struct Camera {
  viewProj : mat4x4f,
  selected : vec4u,
};
@group(0) @binding(0) var<uniform> cam : Camera;
struct ObjMeta { objectId : u32, pad0 : u32, pad1 : u32, pad2 : u32 };
@group(1) @binding(0) var<uniform> obj : ObjMeta;

@fragment fn fsMain(in : VsOut) -> @location(0) vec4f {
  let n = normalize(in.normal);
  let light = normalize(vec3f(0.4, 0.8, 0.6));
  let diff = max(dot(n, light), 0.0) * 0.75 + 0.25;
  var c = in.color.rgb * diff;
  if (cam.selected.x == obj.objectId + 1u && cam.selected.y == in.instId + 1u) {
    c = mix(c, vec3f(1.0, 1.0, 0.6), 0.45);
  }
  return vec4f(c, 1.0);
}
`;

const FRAG_ID = /* wgsl */ `
struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) normal : vec3f,
  @location(1) color : vec4f,
  @location(2) @interpolate(flat) instId : u32,
};
struct ObjMeta { objectId : u32, pad0 : u32, pad1 : u32, pad2 : u32 };
@group(1) @binding(0) var<uniform> obj : ObjMeta;

// 整数附件：r = objectId + 1，g = instanceId + 1，0 表示背景
@fragment fn fsMain(in : VsOut) -> @location(0) vec2u {
  return vec2u(obj.objectId + 1u, in.instId + 1u);
}
`;

export class GpuRenderer {
  constructor(device, canvasFormat) {
    this.device = device;
    this.canvasFormat = canvasFormat;
    this.depthFormat = 'depth24plus';
    this.idTexture = null;
    this.depthTexture = null;
    this.width = 0;
    this.height = 0;
    this.objectGpu = new Map();

    const cube = createCubeVertexData();
    this.cubeVertexBuffer = device.createBuffer({
      size: cube.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.cubeVertexBuffer, 0, cube);
    this.cubeVertexCount = 36;

    this.cameraBuffer = device.createBuffer({
      size: CAMERA_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup0Layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    this.bindGroup1Layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    this.bindGroup0 = device.createBindGroup({
      layout: this.bindGroup0Layout,
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroup0Layout, this.bindGroup1Layout],
    });

    const vertexBuffers = [
      { arrayStride: 24, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
      ] },
      { arrayStride: 80, stepMode: 'instance', attributes: [
        { shaderLocation: 3, offset: 0, format: 'float32x4' },
        { shaderLocation: 4, offset: 16, format: 'float32x4' },
        { shaderLocation: 5, offset: 32, format: 'float32x4' },
        { shaderLocation: 6, offset: 48, format: 'float32x4' },
        { shaderLocation: 7, offset: 64, format: 'float32x4' },
      ] },
    ];
    const depthStencil = {
      format: this.depthFormat,
      depthWriteEnabled: true,
      depthCompare: 'less',
    };
    const primitive = { topology: 'triangle-list', cullMode: 'back' };
    const vertexModule = device.createShaderModule({ code: VERT });

    this.colorPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: vertexModule, entryPoint: 'vsMain', buffers: vertexBuffers },
      fragment: {
        module: device.createShaderModule({ code: FRAG_COLOR }),
        entryPoint: 'fsMain',
        targets: [{ format: canvasFormat }],
      },
      primitive,
      depthStencil,
    });

    this.idPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: vertexModule, entryPoint: 'vsMain', buffers: vertexBuffers },
      fragment: {
        module: device.createShaderModule({ code: FRAG_ID }),
        entryPoint: 'fsMain',
        targets: [{ format: 'rg32uint' }],
      },
      primitive,
      depthStencil,
    });
  }

  // 画布尺寸变化时重建深度与 ID 附件，尺寸与可见画面完全一致
  ensureTargets(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.depthTexture?.destroy();
    this.idTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: { width, height },
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.idTexture = this.device.createTexture({
      size: { width, height },
      format: 'rg32uint',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }

  syncScene(scene) {
    for (const obj of scene.objects) {
      if (obj.deleted) {
        const gpu = this.objectGpu.get(obj.id);
        if (gpu) {
          gpu.instanceBuffer.destroy();
          gpu.metaBuffer.destroy();
          this.objectGpu.delete(obj.id);
        }
        continue;
      }
      if (this.objectGpu.has(obj.id)) continue;
      const count = obj.instances.length;
      const instData = new Float32Array(count * 20);
      for (let i = 0; i < count; i++) {
        instData.set(obj.instances[i].model, i * 20);
        instData.set(obj.color, i * 20 + 16);
      }
      const instanceBuffer = this.device.createBuffer({
        size: instData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(instanceBuffer, 0, instData);
      const meta = new Uint32Array([obj.id, 0, 0, 0]);
      const metaBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(metaBuffer, 0, meta);
      const bindGroup1 = this.device.createBindGroup({
        layout: this.bindGroup1Layout,
        entries: [{ binding: 0, resource: { buffer: metaBuffer } }],
      });
      this.objectGpu.set(obj.id, { instanceBuffer, metaBuffer, bindGroup1, count });
    }
  }

  updateCamera(viewProj, selected) {
    const data = new Float32Array(CAMERA_FLOATS);
    data.set(viewProj, 0);
    const sel = new Uint32Array(data.buffer, 64, 4);
    sel[0] = selected ? selected.objectId + 1 : 0;
    sel[1] = selected ? selected.instanceId + 1 : 0;
    this.device.queue.writeBuffer(this.cameraBuffer, 0, data);
  }

  drawObjects(pass) {
    pass.setBindGroup(0, this.bindGroup0);
    pass.setVertexBuffer(0, this.cubeVertexBuffer);
    for (const gpu of this.objectGpu.values()) {
      pass.setBindGroup(1, gpu.bindGroup1);
      pass.setVertexBuffer(1, gpu.instanceBuffer);
      pass.draw(this.cubeVertexCount, gpu.count);
    }
  }

  // 渲染可见画面；withIdPass 时同时渲染 ID 通道并返回其纹理供像素拷贝
  render(encoder, context, withIdPass) {
    const colorView = context.getCurrentTexture().createView();
    const colorPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: colorView,
        loadOp: 'clear',
        clearValue: { r: 0.12, g: 0.13, b: 0.16, a: 1 },
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthLoadOp: 'clear',
        depthClearValue: 1,
        depthStoreOp: 'store',
      },
    });
    colorPass.setPipeline(this.colorPipeline);
    this.drawObjects(colorPass);
    colorPass.end();

    if (!withIdPass) return;
    const idPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.idTexture.createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthLoadOp: 'clear',
        depthClearValue: 1,
        depthStoreOp: 'store',
      },
    });
    idPass.setPipeline(this.idPipeline);
    this.drawObjects(idPass);
    idPass.end();
  }
}
