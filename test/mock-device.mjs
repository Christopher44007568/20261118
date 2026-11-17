// Minimal WebGPU mock that simulates GPU-side timestamp generation, so the
// profiler's query/resolve/readback wiring can be verified headlessly.

export function installGpuGlobals() {
  globalThis.GPUBufferUsage = {
    MAP_READ: 0x0001, COPY_DST: 0x0002, COPY_SRC: 0x0004,
    QUERY_RESOLVE: 0x0200, UNIFORM: 0x0040, STORAGE: 0x0080,
    VERTEX: 0x0020, INDEX: 0x0010,
  };
  globalThis.GPUMapMode = { READ: 0x0001, WRITE: 0x0002 };
  globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
  globalThis.GPUTextureUsage = {
    COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16,
  };
}

class MockBuffer {
  constructor({ size, usage }) {
    this.size = size;
    this.usage = usage;
    this.data = new ArrayBuffer(size);
    this.mapped = false;
  }

  async mapAsync() { this.mapped = true; }
  getMappedRange() { return this.data; }
  unmap() { this.mapped = false; }
}

class MockQuerySet {
  constructor({ type, count }) {
    this.type = type;
    this.count = count;
  }
}

class MockCommandEncoder {
  constructor(device) {
    this.device = device;
    this.passes = [];
    this.resolved = false;
  }

  beginRenderPass(descriptor) {
    this.passes.push(descriptor);
    return {
      setPipeline() {}, setBindGroup() {}, setVertexBuffer() {},
      setIndexBuffer() {}, draw() {}, drawIndexed() {},
      end() {},
    };
  }

  resolveQuerySet(querySet, firstQuery, queryCount, destination, destinationOffset) {
    // Simulate GPU execution: each pass occupies its configured duration on a
    // monotonically increasing GPU clock.
    const view = new BigUint64Array(destination.data, destinationOffset, queryCount);
    for (let i = 0; i < queryCount / 2; i += 1) {
      const duration = this.device.passDurationsNs[i] ?? 0n;
      const begin = this.device.gpuClockNs;
      this.device.gpuClockNs += duration;
      view[i * 2] = begin;
      view[i * 2 + 1] = this.device.gpuClockNs;
    }
    this.resolved = true;
  }

  copyBufferToBuffer(src, srcOffset, dst, dstOffset, size) {
    const bytes = new Uint8Array(src.data, srcOffset, size);
    new Uint8Array(dst.data, dstOffset, size).set(bytes);
  }

  finish() { return { passes: this.passes }; }
}

export class MockDevice {
  // passDurationsNs: array of BigInt per pass index; may be mutated between
  // frames to simulate spikes.
  constructor(passDurationsNs) {
    this.passDurationsNs = passDurationsNs;
    this.gpuClockNs = 1_000_000_000n; // arbitrary non-zero GPU clock origin
    this.queue = {
      submissions: [],
      submit(cmds) { this.submissions.push(cmds); },
      writeBuffer() {},
    };
  }

  createQuerySet(desc) { return new MockQuerySet(desc); }
  createBuffer(desc) { return new MockBuffer(desc); }
  createCommandEncoder() { return new MockCommandEncoder(this); }
}
