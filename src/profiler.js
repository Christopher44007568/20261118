// GPU timestamp profiler with CPU-interval fallback.
//
// - Wraps each named pass with timestampWrites when the device exposes the
//   'timestamp-query' feature, resolves the query set, and reads results back
//   through a small pool of MAP_READ buffers.
// - Falls back to CPU encode-interval timing (performance.now) otherwise and
//   reports the capability difference via `capabilityNote`.
// - Keeps a 120-frame sliding window per pass (mean / p95 / p99).
// - Paused frames never record: a frame only lands in the stats after its
//   readback resolves exactly once, and beginFrame is a no-op while paused.

import { FrameStats, DEFAULT_WINDOW_SIZE } from './stats.js';

const NS_PER_MS = 1e6;
const MAX_IN_FLIGHT = 4;

export class GpuProfiler {
  constructor({ device, passNames, windowSize = DEFAULT_WINDOW_SIZE, gpuTimestamps, now }) {
    this.device = device;
    this.passNames = passNames;
    this.gpuTimestamps = gpuTimestamps;
    this.now = now ?? (() => performance.now());
    this.stats = new FrameStats(passNames, windowSize);
    this.frameIndex = 0;
    this.paused = false;
    this.activeFrame = null;
    this.pendingReads = [];
    this.freeBuffers = [];

    if (this.gpuTimestamps) {
      const count = passNames.length * 2;
      this.querySet = device.createQuerySet({ type: 'timestamp', count });
      this.resolveBuffer = device.createBuffer({
        size: count * 8,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      for (let i = 0; i < MAX_IN_FLIGHT; i += 1) {
        this.freeBuffers.push(device.createBuffer({
          size: count * 8,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }));
      }
    }
  }

  get mode() {
    return this.gpuTimestamps ? 'gpu' : 'cpu';
  }

  // Human-readable capability difference, surfaced in the HUD.
  get capabilityNote() {
    return this.gpuTimestamps
      ? 'timestamp-query supported: per-pass GPU times from device timestamps (ns).'
      : 'timestamp-query NOT supported: falling back to CPU encode-interval timing '
        + '(measures command encoding cost on the CPU, not GPU execution time).';
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) this.activeFrame = null; // drop any half-encoded frame
  }

  // Returns false when the frame should be skipped entirely (paused, or no
  // readback buffer available in GPU mode), so the renderer does not encode
  // work whose samples could never be recorded.
  beginFrame() {
    if (this.paused || this.activeFrame) return false;
    const frame = { index: this.frameIndex, cpuStarts: new Map(), cpuSamples: {}, readback: null };
    if (this.gpuTimestamps) {
      const buffer = this.freeBuffers.pop();
      if (!buffer) return false; // all in flight; drop this frame's timing
      frame.readback = buffer;
    }
    this.activeFrame = frame;
    return true;
  }

  // Injects timestampWrites into a render/compute pass descriptor (GPU mode),
  // or opens a CPU interval (fallback mode).
  wrapPassDescriptor(name, descriptor) {
    const passIndex = this.passNames.indexOf(name);
    if (passIndex < 0) throw new Error(`unknown pass: ${name}`);
    if (!this.activeFrame) return descriptor;
    if (this.gpuTimestamps) {
      return {
        ...descriptor,
        timestampWrites: {
          querySet: this.querySet,
          beginningOfPassWriteIndex: passIndex * 2,
          endOfPassWriteIndex: passIndex * 2 + 1,
        },
      };
    }
    this.activeFrame.cpuStarts.set(name, this.now());
    return descriptor;
  }

  // Closes a CPU interval in fallback mode. No-op in GPU mode, where the end
  // timestamp is written automatically when the pass ends.
  endPass(name) {
    if (!this.activeFrame || this.gpuTimestamps) return;
    const start = this.activeFrame.cpuStarts.get(name);
    if (start !== undefined) this.activeFrame.cpuSamples[name] = this.now() - start;
  }

  // Appends query resolve + copy to the encoder and finishes the frame.
  // In CPU mode the samples are recorded synchronously here.
  finishFrame(encoder) {
    const frame = this.activeFrame;
    this.activeFrame = null;
    if (!frame) return;
    if (this.gpuTimestamps) {
      const count = this.passNames.length * 2;
      encoder.resolveQuerySet(this.querySet, 0, count, this.resolveBuffer, 0);
      encoder.copyBufferToBuffer(this.resolveBuffer, 0, frame.readback, 0, count * 8);
      this.pendingReads.push(frame);
    } else {
      this.stats.recordFrame(frame.cpuSamples);
    }
    this.frameIndex += 1;
  }

  // Resolves at most one pending readback. Each frame's samples are recorded
  // exactly once, when its buffer maps; the buffer then returns to the pool.
  async poll() {
    const frame = this.pendingReads.shift();
    if (!frame) return false;
    const buffer = frame.readback;
    await buffer.mapAsync(GPUMapMode.READ);
    const ticks = new BigUint64Array(buffer.getMappedRange());
    const samples = {};
    for (let i = 0; i < this.passNames.length; i += 1) {
      const begin = ticks[i * 2];
      const end = ticks[i * 2 + 1];
      if (end >= begin) samples[this.passNames[i]] = Number(end - begin) / NS_PER_MS;
    }
    buffer.unmap();
    this.freeBuffers.push(buffer);
    this.stats.recordFrame(samples);
    return true;
  }

  async drain() {
    while (this.pendingReads.length > 0) await this.poll();
  }

  snapshot() {
    return { mode: this.mode, capabilityNote: this.capabilityNote, passes: this.stats.snapshot() };
  }
}
