export const DEFAULT_LEVELS = Object.freeze([
  { level: 0, size: 64, label: "L0", name: "BASE" },
  { level: 1, size: 128, label: "L1", name: "NEAR" },
  { level: 2, size: 256, label: "L2", name: "CLOSE" },
  { level: 3, size: 512, label: "L3", name: "DETAIL" }
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function colorDistance(a, b) {
  if (!a || !b) return 0;
  const r = a[0] - b[0];
  const g = a[1] - b[1];
  const b0 = a[2] - b[2];
  return Math.sqrt(r * r + g * g + b0 * b0);
}

function isAbort(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

export class TextureStreamer {
  constructor({
    levels = DEFAULT_LEVELS,
    loader,
    concurrency = 3,
    fadeMs = 360,
    now = () => performance.now(),
    onChange = null,
    onEvent = null
  } = {}) {
    if (typeof loader !== "function") throw new TypeError("loader is required");
    this.levels = [...levels].sort((a, b) => a.level - b.level);
    this.loader = loader;
    this.concurrency = Math.max(1, concurrency);
    this.fadeMs = fadeMs;
    this.now = now;
    this.onChange = onChange;
    this.onEvent = onEvent;
    this.assets = new Map();
    this.queue = [];
    this.inFlight = new Map();
    this.disposed = false;
    this.stats = {
      requests: 0,
      replacements: 0,
      cacheHits: 0,
      failures: 0,
      cancellations: 0,
      colorDriftTotal: 0,
      colorDriftSamples: 0,
      colorDriftMax: 0,
      swapDriftMax: 0
    };
    this._pumping = false;
  }

  addAsset({ id, name, targetLevel = 0, referenceAverage = null, meta = {} }) {
    if (!id || this.assets.has(id)) throw new Error(`invalid or duplicate asset: ${id}`);
    const state = {
      id,
      name,
      meta,
      targetLevel: clamp(targetLevel, 0, this.levels.at(-1).level),
      referenceAverage: referenceAverage ? [...referenceAverage] : null,
      levels: new Map(),
      failed: new Set(),
      current: null,
      currentLevel: null,
      previous: null,
      previousLevel: null,
      swapAt: 0,
      driftChecked: new Set()
    };
    this.assets.set(id, state);
    return state;
  }

  kick(reason = "start") {
    this._rebuildQueue();
    this._pump();
    this._changed(reason);
  }

  setTargets(targets, reason = "camera") {
    let changed = false;
    for (const [id, requested] of Object.entries(targets)) {
      const state = this.assets.get(id);
      if (!state) continue;
      const next = clamp(Math.round(requested), 0, this.levels.at(-1).level);
      if (state.targetLevel === next) continue;

      const previousTarget = state.targetLevel;
      const previousCurrent = state.currentLevel;
      state.targetLevel = next;
      changed = true;
      if (next < previousTarget) this._cancelObsolete(state);

      this._syncDisplay(state);
      if (next > previousTarget && state.currentLevel === next && state.currentLevel > previousCurrent) {
        this.stats.cacheHits += 1;
        this._emit("cache-hit", {
          assetId: id,
          level: next,
          age: Math.round(this.now() - (state.levels.get(next)?.loadedAt || this.now()))
        });
      }
    }

    if (changed) {
      this._rebuildQueue();
      this._pump();
      this._changed(reason);
    }
    return changed;
  }

  _cancelObsolete(state) {
    for (const [key, task] of this.inFlight) {
      if (task.assetId !== state.id || task.level <= state.targetLevel || task.cancelled) continue;
      task.cancelled = true;
      task.controller.abort("camera-lod-changed");
      this.inFlight.delete(key);
      this.stats.cancellations += 1;
      this._emit("cancelled", { assetId: state.id, level: task.level, key });
    }
  }

  _syncDisplay(state) {
    const candidates = this.levels
      .filter((definition) => definition.level <= state.targetLevel && state.levels.has(definition.level))
      .sort((a, b) => b.level - a.level);
    if (!candidates.length) return state.currentLevel;
    const best = candidates[0];
    if (best.level !== state.currentLevel) this._apply(state, best.level, "scheduler");
    return state.currentLevel;
  }

  _apply(state, level, source) {
    const payload = state.levels.get(level);
    if (!payload || state.currentLevel === level) return false;
    const previousLevel = state.currentLevel;
    const previous = state.current;
    state.previous = previous;
    state.previousLevel = previousLevel;
    state.current = payload;
    state.currentLevel = level;
    state.swapAt = this.now();

    if (previousLevel !== null && level > previousLevel) {
      this.stats.replacements += 1;
      this.stats.swapDriftMax = Math.max(
        this.stats.swapDriftMax,
        colorDistance(previous?.average, payload.average)
      );
    }
    this._emit("applied", { assetId: state.id, level, previousLevel, source });
    return true;
  }

  _neededLevel(state) {
    for (const definition of this.levels) {
      if (definition.level > state.targetLevel) break;
      if (state.failed.has(definition.level)) return null;
      if (!state.levels.has(definition.level)) return definition;
    }
    return null;
  }

  _rebuildQueue() {
    const nextQueue = [];
    for (const state of this.assets.values()) {
      const definition = this._neededLevel(state);
      if (!definition) continue;
      const key = `${state.id}:${definition.level}`;
      if (this.inFlight.has(key)) continue;
      nextQueue.push({
        key,
        assetId: state.id,
        level: definition.level,
        definition,
        priority: definition.level * 1000 - state.targetLevel * 100
      });
    }
    nextQueue.sort((a, b) => a.priority - b.priority || a.assetId.localeCompare(b.assetId));
    this.queue = nextQueue;
  }

  _pump() {
    if (this._pumping || this.disposed) return;
    this._pumping = true;
    try {
      while (this.inFlight.size < this.concurrency && this.queue.length) {
        const task = this.queue.shift();
        const state = this.assets.get(task.assetId);
        const needed = state && this._neededLevel(state);
        if (!state || !needed || needed.level !== task.level || this.inFlight.has(task.key)) continue;
        this._start(state, needed);
      }
    } finally {
      this._pumping = false;
    }
  }

  _start(state, definition) {
    const controller = new AbortController();
    const task = {
      key: `${state.id}:${definition.level}`,
      assetId: state.id,
      level: definition.level,
      controller,
      cancelled: false
    };
    this.inFlight.set(task.key, task);
    this.stats.requests += 1;
    this._emit("request", { assetId: state.id, level: definition.level });

    Promise.resolve()
      .then(() => this.loader({
        asset: state,
        level: definition.level,
        definition,
        signal: controller.signal
      }))
      .then((payload) => {
        if (task.cancelled || this.disposed) return;
        this._accept(state, definition, payload);
      })
      .catch((error) => {
        if (task.cancelled || this.disposed) return;
        if (isAbort(error)) {
          this.stats.cancellations += 1;
          this._emit("cancelled", { assetId: state.id, level: definition.level, key: task.key });
          return;
        }
        state.failed.add(definition.level);
        this.stats.failures += 1;
        this._emit("failed", {
          assetId: state.id,
          level: definition.level,
          message: error?.message || "load failed"
        });
      })
      .finally(() => {
        if (this.inFlight.get(task.key) !== task) return;
        this.inFlight.delete(task.key);
        this._rebuildQueue();
        this._pump();
        this._changed("settled");
      });
  }

  _accept(state, definition, payload) {
    if (!payload) throw new Error("loader returned no payload");
    const normalized = {
      ...payload,
      level: definition.level,
      width: payload.width || definition.size,
      height: payload.height || definition.size,
      bytes: payload.bytes || definition.size * definition.size * 4,
      average: payload.average || state.referenceAverage || [0, 0, 0],
      loadedAt: this.now()
    };
    state.levels.set(definition.level, normalized);
    state.failed.delete(definition.level);

    if (!state.referenceAverage) state.referenceAverage = [...normalized.average];
    if (!state.driftChecked.has(definition.level)) {
      state.driftChecked.add(definition.level);
      const drift = colorDistance(normalized.average, state.referenceAverage);
      this.stats.colorDriftTotal += drift;
      this.stats.colorDriftSamples += 1;
      this.stats.colorDriftMax = Math.max(this.stats.colorDriftMax, drift);
    }
    this._syncDisplay(state);
    this._emit("loaded", {
      assetId: state.id,
      level: definition.level,
      bytes: normalized.bytes,
      drift: colorDistance(normalized.average, state.referenceAverage)
    });
  }

  retryFailures() {
    let count = 0;
    for (const state of this.assets.values()) {
      count += state.failed.size;
      state.failed.clear();
    }
    this._rebuildQueue();
    this._pump();
    if (count) this._changed("retry");
    return count;
  }

  abortInFlight(reason = "user") {
    let count = 0;
    for (const [key, task] of this.inFlight) {
      if (task.cancelled) continue;
      task.cancelled = true;
      task.controller.abort(reason);
      this.inFlight.delete(key);
      count += 1;
      this.stats.cancellations += 1;
      this._emit("cancelled", { assetId: task.assetId, level: task.level, key, reason });
    }
    this._rebuildQueue();
    if (count) this._changed("abort");
    return count;
  }

  getAsset(id) {
    return this.assets.get(id) || null;
  }

  getSnapshot() {
    const byLevel = this.levels.map((definition) => {
      let count = 0;
      let bytes = 0;
      for (const state of this.assets.values()) {
        const payload = state.levels.get(definition.level);
        if (!payload) continue;
        count += 1;
        bytes += payload.bytes;
      }
      return {
        ...definition,
        count,
        bytes,
        queued: this.queue.filter((task) => task.level === definition.level).length,
        active: [...this.inFlight.values()].filter((task) => task.level === definition.level).length
      };
    });
    const bytes = byLevel.reduce((total, level) => total + level.bytes, 0);
    const samples = this.stats.colorDriftSamples;
    const heldFailures = [...this.assets.values()].reduce((total, state) => total + state.failed.size, 0);
    return {
      levels: byLevel,
      bytes,
      queue: this.queue.length,
      active: this.inFlight.size,
      queuedTasks: this.queue.map(({ assetId, level, key }) => ({ assetId, level, key })),
      activeTasks: [...this.inFlight.values()].map(({ assetId, level, key }) => ({ assetId, level, key })),
      requests: this.stats.requests,
      replacements: this.stats.replacements,
      cacheHits: this.stats.cacheHits,
      failures: this.stats.failures,
      heldFailures,
      cancellations: this.stats.cancellations,
      colorDriftMax: this.stats.colorDriftMax,
      swapDriftMax: this.stats.swapDriftMax,
      colorDriftMean: samples ? this.stats.colorDriftTotal / samples : 0,
      idle: this.queue.length === 0 && this.inFlight.size === 0,
      assets: [...this.assets.values()].map((state) => ({
        id: state.id,
        name: state.name,
        targetLevel: state.targetLevel,
        currentLevel: state.currentLevel,
        residentLevels: [...state.levels.keys()],
        failedLevels: [...state.failed]
      }))
    };
  }

  waitForIdle(timeoutMs = 10000) {
    const deadline = this.now() + timeoutMs;
    return new Promise((resolve) => {
      const check = () => {
        const snapshot = this.getSnapshot();
        if (snapshot.idle) {
          clearInterval(timer);
          resolve(true);
        } else if (this.now() >= deadline) {
          clearInterval(timer);
          resolve(false);
        }
      };
      const timer = setInterval(check, 25);
      check();
    });
  }

  dispose() {
    this.disposed = true;
    this.abortInFlight("dispose");
    this.queue = [];
  }

  _changed(reason) {
    this.onChange?.(this.getSnapshot(), reason);
  }

  _emit(type, detail = {}) {
    this.onEvent?.({ type, at: this.now(), ...detail });
  }
}
