import { variantKey, fallbackVariant } from './variantKey.js';

// 缓存条目状态：
//   compiling -> ready | error
// 同键的并发请求共享同一个 in-flight promise，绝不重复提交编译。

export class PipelineCache {
  constructor(compiler, { capacity = 12, now } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('capacity 必须是正整数');
    }
    this.compiler = compiler;
    this.capacity = capacity;
    this.now = now || (() => (typeof performance !== 'undefined'
      ? performance.now()
      : Number(process.hrtime.bigint() / 1000000n)));
    // Map 保持插入顺序，配合 delete+set 实现 LRU 重排
    this.entries = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      compiles: 0,
      compileFailures: 0,
      fallbacks: 0,
      evictions: 0,
      inFlightShared: 0,
    };
  }

 get size() {
    return this.entries.size;
  }

  get queueDepth() {
    return [...this.entries.values()].filter((e) => e.status === 'compiling').length;
  }

  get readyCount() {
    return [...this.entries.values()].filter((e) => e.status === 'ready').length;
  }

  get hitRate() {
    const total = this.stats.hits + this.stats.misses;
    return total === 0 ? null : this.stats.hits / total;
  }

  // 容量满时淘汰最久未使用的 ready 条目；compiling/error 条目不动
  evictIfNeeded() {
    while (this.entries.size >= this.capacity) {
      const protectedKeys = new Set();
      for (const entry of this.entries.values()) {
        if (entry.status === 'error' && entry.fallbackKey) {
          protectedKeys.add(entry.fallbackKey);
        }
      }
      const victim = this.entries
        .entries()
        .find(([key, entry]) => entry.status === 'ready' && !protectedKeys.has(key));
      if (!victim) return;
      const [victimKey] = victim;
      this.entries.delete(victimKey);
      this.stats.evictions += 1;
    }
  }

  // 核心入口：命中即返回；未命中才编译；失败回退到保守变体
  async getOrCompile(variant) {
    const key = variantKey(variant);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.status === 'compiling') {
        // 已有相同变体在编译中：共享 promise，不重复编译
        this.stats.inFlightShared += 1;
        return existing.promise;
      }
      // LRU 命中：提到最近使用位置
      this.entries.delete(key);
      this.entries.set(key, existing);
      existing.lastAccessAt = this.now();
      this.stats.hits += 1;
      if (existing.status === 'ready') return existing.pipeline;
      // 已知失败变体：复用缓存的回退管线，不再重复编译原变体
      const fallbackEntry = this.entries.get(existing.fallbackKey);
      if (fallbackEntry && fallbackEntry.status === 'ready') {
        this.entries.delete(existing.fallbackKey);
        this.entries.set(existing.fallbackKey, fallbackEntry);
        fallbackEntry.lastAccessAt = this.now();
        return fallbackEntry.pipeline;
      }
      // 回退条目已被淘汰：重新走统一入口编译回退变体
      return this.getOrCompile(fallbackVariant(existing.variant));
    }

    this.stats.misses += 1;
    this.stats.compiles += 1;
    this.evictIfNeeded();

    const entry = {
      key,
      variant,
      status: 'compiling',
      createdAt: this.now(),
      lastAccessAt: this.now(),
      pipeline: null,
      error: null,
      fallbackFrom: null,
      promise: null,
    };
    const promise = this._runCompile(entry);
    entry.promise = promise;
    this.entries.set(key, entry);
    return promise;
  }

  async _runCompile(entry) {
    try {
      const pipeline = await this.compiler.compile(entry.variant);
      entry.status = 'ready';
      entry.pipeline = pipeline;
      return pipeline;
    } catch (error) {
      entry.status = 'error';
      entry.error = error;
      this.stats.compileFailures += 1;
      return this._fallback(entry);
    }
  }

  async _fallback(failedEntry) {
    const fb = fallbackVariant(failedEntry.variant);
    const fbKey = variantKey(fb);
    this.stats.fallbacks += 1;
    failedEntry.fallbackFrom = failedEntry.key;
    failedEntry.fallbackKey = fbKey;

    const cachedFallback = this.entries.get(fbKey);
    if (cachedFallback && cachedFallback.status === 'ready') {
      this.stats.hits += 1;
      this.entries.delete(fbKey);
      this.entries.set(fbKey, cachedFallback);
      cachedFallback.lastAccessAt = this.now();
      failedEntry.pipeline = cachedFallback.pipeline;
      return cachedFallback.pipeline;
    }
    // 回退变体本身也走统一入口（可能仍在编译中，自动共享 promise）
    const pipeline = await this.getOrCompile(fb);
    failedEntry.pipeline = pipeline;
    return pipeline;
  }

  has(key) {
    return this.entries.has(key);
  }

  snapshot() {
    return {
      capacity: this.capacity,
      size: this.entries.size,
      readyCount: this.readyCount,
      queueDepth: this.queueDepth,
      hitRate: this.hitRate,
      stats: { ...this.stats },
      entries: [...this.entries.entries()].map(([key, entry], index) => ({
        lruIndex: index,
        key,
        status: entry.status,
        fallbackFrom: entry.fallbackFrom,
        fallbackKey: entry.fallbackKey,
        lastAccessAt: entry.lastAccessAt,
      })),
    };
  }
}
