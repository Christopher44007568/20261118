import { ResourceAllocator } from './resource-allocator.js';

export class RenderGraphError extends Error {}

export class RenderGraph {
  constructor(device) {
    this.device = device;
    this.allocator = new ResourceAllocator(device);
    this.passes = new Map();
    this.externalTextures = new Map();
    this.frameIndex = 0;
  }

  registerExternalTexture(resourceName, texture) {
    if (this.passes.has(resourceName) || this.externalTextures.has(resourceName)) {
      throw new RenderGraphError(`Resource already exists: ${resourceName}`);
    }
    this.externalTextures.set(resourceName, texture);
  }

  addPass(config) {
    const pass = normalizePass(config);
    if (this.passes.has(pass.name)) {
      throw new RenderGraphError(`Pass already exists: ${pass.name}`);
    }
    this.passes.set(pass.name, pass);
    return pass;
  }

  setPassEnabled(passName, enabled) {
    const pass = this.getPass(passName);
    pass.enabled = enabled;
    if (!enabled) {
      this.releasePassOutputs(pass);
    }
  }

  setInput(passName, inputName, source) {
    const pass = this.getPass(passName);
    const index = pass.inputs.findIndex((input) => input.name === inputName);
    const nextInput = {
      name: inputName,
      resource: source.resource,
      format: source.format
    };
    if (index === -1) {
      pass.inputs.push(nextInput);
    } else {
      pass.inputs[index] = nextInput;
    }
  }

  setInputFormat(passName, inputName, format) {
    const pass = this.getPass(passName);
    const input = pass.inputs.find((entry) => entry.name === inputName);
    if (!input) {
      throw new RenderGraphError(
        `Pass ${passName} does not declare input ${inputName}`
      );
    }
    input.format = format;
  }

  getPass(passName) {
    const pass = this.passes.get(passName);
    if (!pass) {
      throw new RenderGraphError(`Unknown pass: ${passName}`);
    }
    return pass;
  }

  getTexture(resourceName) {
    if (this.externalTextures.has(resourceName)) {
      return this.externalTextures.get(resourceName);
    }
    return this.allocator.get(resourceName);
  }

  dispose() {
    this.allocator.releaseAll();
  }

  compile() {
    const enabledPasses = [...this.passes.values()].filter((pass) => pass.enabled);
    const enabledNames = new Set(enabledPasses.map((pass) => pass.name));
    const producers = this.collectProducers(enabledPasses);
    const edges = this.collectEdges(enabledPasses, producers, enabledNames);
    const order = topologicalSort(enabledPasses, edges);
    this.validateInputs(enabledPasses, producers);

    return {
      order,
      producers,
      activeResources: new Set(
        enabledPasses.flatMap((pass) => pass.outputs.map((output) => output.resource))
      )
    };
  }

  execute() {
    const plan = this.compile();
    this.allocator.beginFrame();
    this.releaseInactiveResources(plan.activeResources);

    for (const passName of plan.order) {
      const pass = this.passes.get(passName);
      const inputs = this.resolveInputTextures(pass);
      const outputs = this.resolveOutputTextures(pass);
      pass.execute({
        device: this.device,
        pass,
        inputs,
        outputs,
        frame: this.frameIndex
      });
    }

    this.frameIndex += 1;
    return {
      order: plan.order,
      output: this.getTexture(this.chooseFinalResource(plan.order))
    };
  }

  releasePassOutputs(pass) {
    for (const output of pass.outputs) {
      this.allocator.release(output.resource);
    }
  }

  collectProducers(enabledPasses) {
    const producers = new Map();
    for (const pass of enabledPasses) {
      for (const output of pass.outputs) {
        if (producers.has(output.resource)) {
          throw new RenderGraphError(
            `Resource ${output.resource} has multiple producers: ` +
              `${producers.get(output.resource)} and ${pass.name}`
          );
        }
        producers.set(output.resource, {
          pass: pass.name,
          format: output.descriptor.format
        });
      }
    }
    return producers;
  }

  collectEdges(enabledPasses, producers, enabledNames) {
    const edges = new Map(enabledPasses.map((pass) => [pass.name, new Set()]));

    for (const pass of enabledPasses) {
      for (const dependency of pass.dependencies) {
        if (!enabledNames.has(dependency)) {
          throw new RenderGraphError(
            `Pass ${pass.name} depends on disabled or unknown pass ${dependency}`
          );
        }
        edges.get(pass.name).add(dependency);
      }

      for (const input of pass.inputs) {
        const producer = producers.get(input.resource);
        if (producer) {
          edges.get(pass.name).add(producer.pass);
        }
      }
    }

    return edges;
  }

  validateInputs(enabledPasses, producers) {
    for (const pass of enabledPasses) {
      for (const input of pass.inputs) {
        const producer = producers.get(input.resource);
        const external = this.externalTextures.get(input.resource);
        const actualFormat = producer?.format ?? external?.format;

        if (!producer && !external) {
          throw new RenderGraphError(
            `Pass ${pass.name} input ${input.name} has no source resource: ${input.resource}`
          );
        }
        if (actualFormat !== input.format) {
          throw new RenderGraphError(
            `Format mismatch for ${pass.name}.${input.name}: expected ${input.format}, ` +
              `but ${input.resource} provides ${actualFormat}`
          );
        }
      }
    }
  }

  resolveInputTextures(pass) {
    const inputs = {};
    for (const input of pass.inputs) {
      inputs[input.name] = this.getTexture(input.resource);
    }
    return inputs;
  }

  resolveOutputTextures(pass) {
    const outputs = {};
    for (const output of pass.outputs) {
      outputs[output.name] = this.allocator.ensure(
        output.resource,
        output.descriptor
      );
    }
    return outputs;
  }

  releaseInactiveResources(activeResources) {
    for (const resourceName of this.allocator.textures.keys()) {
      if (!activeResources.has(resourceName)) {
        this.allocator.release(resourceName);
      }
    }
  }

  chooseFinalResource(order) {
    const lastPass = this.passes.get(order[order.length - 1]);
    return lastPass.outputs[0].resource;
  }
}

function normalizePass(config) {
  return {
    name: config.name,
    enabled: config.enabled ?? true,
    dependencies: [...(config.dependencies ?? [])],
    inputs: config.inputs.map((input) => ({ ...input })),
    outputs: config.outputs.map((output) => ({
      name: output.name,
      resource: output.resource,
      descriptor: {
        ...output.descriptor,
        size: [...output.descriptor.size]
      }
    })),
    execute: config.execute
  };
}

function topologicalSort(passes, edges) {
  const visited = new Set();
  const stack = [];
  const inStack = new Set();
  const order = [];

  const visit = (passName) => {
    if (visited.has(passName)) {
      return;
    }
    if (inStack.has(passName)) {
      const cycleStart = stack.indexOf(passName);
      const cycle = [...stack.slice(cycleStart), passName].join(' -> ');
      throw new RenderGraphError(`Cyclic pass dependency detected: ${cycle}`);
    }

    stack.push(passName);
    inStack.add(passName);
    for (const dependency of edges.get(passName)) {
      visit(dependency);
    }
    stack.pop();
    inStack.delete(passName);
    visited.add(passName);
    order.push(passName);
  };

  for (const pass of passes) {
    visit(pass.name);
  }
  return order;
}
