// WebGPU 设备、几何与管线初始化

import { cullWGSL, finalizeWGSL, renderWGSL } from './shaders.js';

async function checkedModule(device, code, label) {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const problems = info.messages.filter((m) => m.type === 'error' || m.type === 'warning');
  if (problems.length) {
    const text = problems.map((m) => `[${m.type}] ${m.message} (line ${m.lineNum})`).join('\n');
    throw new Error(`${label} 着色器编译问题:\n${text}`);
  }
  return module;
}

export const INSTANCE_FIELDS = 28; // mat4(16) + center(3) + half(3) + color(3) + category(1)
export const INSTANCE_STRIDE = INSTANCE_FIELDS * 4;

export async function initDevice(canvas) {
  if (!navigator.gpu) throw new Error('当前浏览器不支持 WebGPU');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('未找到可用 GPU 适配器');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  return { device, context, format };
}

// 单位立方体：36 顶点（非索引），每顶点带面法线
export function createCubeGeometry(device) {
  const faces = [
    { n: [1, 0, 0], v: [[ 1,-1,-1],[ 1, 1,-1],[ 1, 1, 1],[ 1,-1,-1],[ 1, 1, 1],[ 1,-1, 1]] },
    { n: [-1, 0, 0], v: [[-1,-1, 1],[-1, 1, 1],[-1, 1,-1],[-1,-1, 1],[-1, 1,-1],[-1,-1,-1]] },
    { n: [0, 1, 0], v: [[-1, 1,-1],[-1, 1, 1],[ 1, 1, 1],[-1, 1,-1],[ 1, 1, 1],[ 1, 1,-1]] },
    { n: [0,-1, 0], v: [[-1,-1, 1],[-1,-1,-1],[ 1,-1,-1],[-1,-1, 1],[ 1,-1,-1],[ 1,-1, 1]] },
    { n: [0, 0, 1], v: [[-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1,-1, 1],[ 1, 1, 1],[-1, 1, 1]] },
    { n: [0, 0,-1], v: [[ 1,-1,-1],[-1,-1,-1],[-1, 1,-1],[ 1,-1,-1],[-1, 1,-1],[ 1, 1,-1]] },
  ];
  const data = new Float32Array(36 * 6);
  let k = 0;
  for (const face of faces) {
    for (const pos of face.v) {
      data.set(pos, k);
      data.set(face.n, k + 3);
      k += 6;
    }
  }
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, data);
  return { buffer, count: 36 };
}

export function createInstanceBuffer(device, maxInstances) {
  return device.createBuffer({
    size: maxInstances * INSTANCE_STRIDE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

export function writeInstance(device, buffer, offsetFloats, inst) {
  const f = new Float32Array(INSTANCE_FIELDS);
  f.set(inst.model, 0);
  f.set(inst.world.center, 16);
  f.set(inst.world.half, 19);
  f.set(inst.color, 22);
  f[25] = inst.category;
  device.queue.writeBuffer(buffer, offsetFloats * 4, f);
}

export async function createPipelines(device, format) {
  const cullModule = await checkedModule(device, cullWGSL, 'cull');
  const finalizeModule = await checkedModule(device, finalizeWGSL, 'finalize');
  const renderModule = await checkedModule(device, renderWGSL, 'render');
  const cull = device.createComputePipeline({
    layout: 'auto',
    compute: { module: cullModule, entryPoint: 'main' },
  });
  const finalize = device.createComputePipeline({
    layout: 'auto',
    compute: { module: finalizeModule, entryPoint: 'main' },
  });

  const render = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: renderModule,
      entryPoint: 'vsMain',
      buffers: [{
        arrayStride: 24,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
        ],
      }],
    },
    fragment: {
      module: renderModule,
      entryPoint: 'fsMain',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });

  return { cull, finalize, render };
}
