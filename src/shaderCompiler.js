import { variantKey, ShaderCompileError } from './variantKey.js';

// 模拟真实 GPU 驱动的异步 shader 编译：
// - 有并发上限的编译队列（对应驱动的 shader 编译线程池）
// - 可配置编译耗时
// - 可注入必失败的变体，用于验证错误回退

const defaultNow = () =>
  typeof performance !== 'undefined' ? performance.now() : Number(process.hrtime.bigint() / 1000000n);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class SimulatedShaderCompiler {
  constructor({
    baseLatencyMs = 40,
    jitterMs = 20,
    maxConcurrent = 2,
    now = defaultNow,
    failingKeys = [],
  } = {}) {
    this.baseLatencyMs = baseLatencyMs;
    this.jitterMs = jitterMs;
    this.maxConcurrent = maxConcurrent;
    this.now = now;
    this.failingKeys = new Set(failingKeys);
    this.activeCount = 0;
    this.totalCompiled = 0;
    this.totalFailed = 0;
    this.history = [];
  }

  markFailing(variant) {
    this.failingKeys.add(variantKey(variant));
  }

  clearFailing() {
    this.failingKeys.clear();
  }

  queueDepth() {
    return Math.max(0, this.activeCount - this.maxConcurrent);
  }

  async compile(variant) {
    const key = variantKey(variant);
    while (this.activeCount >= this.maxConcurrent) {
      await delay(2);
    }
    this.activeCount += 1;
    const startedAt = this.now();
    const latency = this.baseLatencyMs + Math.random() * this.jitterMs;
    try {
      await delay(latency);
      if (this.failingKeys.has(key)) {
        this.totalFailed += 1;
        this.history.push({ key, ok: false, latencyMs: this.now() - startedAt });
        throw new ShaderCompileError(key, '驱动返回编译错误');
      }
      this.totalCompiled += 1;
      this.history.push({ key, ok: true, latencyMs: this.now() - startedAt });
      // 伪 PSO 句柄：真实实现里这里是驱动返回的管线对象
      return Object.freeze({
        handle: `pso#${this.totalCompiled}:${key}`,
        key,
        compiledAt: this.now(),
        compileLatencyMs: latency,
      });
    } finally {
      this.activeCount -= 1;
    }
  }
}
