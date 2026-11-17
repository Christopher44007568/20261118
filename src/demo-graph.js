import { MockGPUDevice } from './gpu-device.js';
import { RenderGraph } from './render-graph.js';

const GPU_USAGE = {
  TEXTURE_BINDING: 0x04,
  RENDER_ATTACHMENT: 0x10,
  STORAGE_BINDING: 0x08
};

export const RENDER_WIDTH = 512;
export const RENDER_HEIGHT = 512;

export function createDemoGraph(device = new MockGPUDevice()) {
  const graph = new RenderGraph(device);
  const calls = [];

  const environmentMap = device.createTexture({
    label: 'environment-map',
    size: [RENDER_WIDTH, RENDER_HEIGHT, 1],
    format: 'rgba8unorm',
    usage: GPU_USAGE.TEXTURE_BINDING
  });
  graph.registerExternalTexture('environmentMap', environmentMap);

  graph.addPass({
    name: 'shadow',
    inputs: [],
    outputs: [
      {
        name: 'shadowMap',
        resource: 'shadowMap',
        descriptor: {
          size: [RENDER_WIDTH, RENDER_HEIGHT, 1],
          format: 'depth24plus',
          usage: GPU_USAGE.RENDER_ATTACHMENT
        }
      }
    ],
    execute: (context) => calls.push(context.pass.name)
  });

  graph.addPass({
    name: 'mainScene',
    inputs: [
      { name: 'shadowMap', resource: 'shadowMap', format: 'depth24plus' },
      { name: 'environmentMap', resource: 'environmentMap', format: 'rgba8unorm' }
    ],
    outputs: [
      {
        name: 'sceneColor',
        resource: 'sceneColor',
        descriptor: {
          size: [RENDER_WIDTH, RENDER_HEIGHT, 1],
          format: 'rgba16float',
          usage: GPU_USAGE.RENDER_ATTACHMENT | GPU_USAGE.TEXTURE_BINDING
        }
      }
    ],
    execute: (context) => calls.push(context.pass.name)
  });

  graph.addPass({
    name: 'volumetricFog',
    inputs: [
      { name: 'sceneColor', resource: 'sceneColor', format: 'rgba16float' },
      { name: 'shadowMap', resource: 'shadowMap', format: 'depth24plus' }
    ],
    outputs: [
      {
        name: 'fogColor',
        resource: 'fogColor',
        descriptor: {
          size: [RENDER_WIDTH, RENDER_HEIGHT, 1],
          format: 'rgba16float',
          usage: GPU_USAGE.STORAGE_BINDING | GPU_USAGE.TEXTURE_BINDING
        }
      }
    ],
    execute: (context) => calls.push(context.pass.name)
  });

  graph.addPass({
    name: 'tonemap',
    inputs: [
      { name: 'sourceColor', resource: 'fogColor', format: 'rgba16float' }
    ],
    outputs: [
      {
        name: 'finalColor',
        resource: 'finalColor',
        descriptor: {
          size: [RENDER_WIDTH, RENDER_HEIGHT, 1],
          format: 'rgba8unorm',
          usage: GPU_USAGE.RENDER_ATTACHMENT | GPU_USAGE.TEXTURE_BINDING
        }
      }
    ],
    execute: (context) => calls.push(context.pass.name)
  });

  return { graph, device, calls };
}

export function setFogEnabled(demo, enabled) {
  demo.graph.setPassEnabled('volumetricFog', enabled);
  demo.graph.setInput('tonemap', 'sourceColor', {
    resource: enabled ? 'fogColor' : 'sceneColor',
    format: 'rgba16float'
  });
}

