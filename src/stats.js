// Sliding-window frame statistics for per-pass timing samples.
// Pure logic, no WebGPU dependency, so it is unit-testable in Node.

export const DEFAULT_WINDOW_SIZE = 120;

export class PassStats {
  constructor(windowSize = DEFAULT_WINDOW_SIZE) {
    this.windowSize = windowSize;
    this.samples = []; // ring buffer of milliseconds, oldest first
    this.head = 0;
    this.count = 0;
  }

  push(ms) {
    if (!Number.isFinite(ms)) return;
    if (this.count < this.windowSize) {
      this.samples.push(ms);
      this.count += 1;
    } else {
      this.samples[this.head] = ms;
      this.head = (this.head + 1) % this.windowSize;
    }
  }

  get size() {
    return this.count;
  }

  values() {
    if (this.count < this.windowSize) return this.samples.slice();
    return this.samples.slice(this.head).concat(this.samples.slice(0, this.head));
  }

  mean() {
    if (this.count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.count; i += 1) sum += this.samples[i];
    return sum / this.count;
  }

  // High percentile (default p95) over the current window.
  percentile(p = 0.95) {
    if (this.count === 0) return 0;
    const sorted = this.values().sort((a, b) => a - b);
    const rank = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
    return sorted[Math.max(0, rank)];
  }

  snapshot() {
    return { mean: this.mean(), p95: this.percentile(0.95), p99: this.percentile(0.99), n: this.count };
  }
}

export class FrameStats {
  constructor(passNames, windowSize = DEFAULT_WINDOW_SIZE) {
    this.windowSize = windowSize;
    this.perPass = new Map();
    for (const name of passNames) this.perPass.set(name, new PassStats(windowSize));
  }

  // Records one frame's worth of samples. `samples` maps pass name -> ms.
  // Only passes present in the map are updated, so a missing pass never
  // accumulates a phantom zero sample.
  recordFrame(samples) {
    for (const [name, ms] of Object.entries(samples)) {
      const stat = this.perPass.get(name);
      if (stat) stat.push(ms);
    }
  }

  snapshot() {
    const out = {};
    for (const [name, stat] of this.perPass) out[name] = stat.snapshot();
    return out;
  }
}
