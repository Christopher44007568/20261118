// 异步拾取管理器：
// - 每帧最多提交一个拾取请求（取最新鼠标位置）
// - 从缓冲池获取 MAP_READ 暂存缓冲，copyTextureToBuffer 拷贝目标像素
// - mapAsync 完成后校验场景版本：版本不符或对象已删除则丢弃，绝不恢复旧选中
// - 缓冲用毕立即 unmap 并归还池中复用

const PICK_BUFFER_SIZE = 256; // copyTextureToBuffer 的 bytesPerRow 对齐要求

export class PickManager {
  constructor(device, poolSize = 4) {
    this.device = device;
    this.pool = [];
    this.stats = {
      requests: 0,
      submitted: 0,
      droppedNoBuffer: 0,
      validHits: 0,
      backgroundHits: 0,
      discarded: 0,
      mismatches: 0,
      poolCreated: 0,
      poolReused: 0,
      lastLatencyMs: 0,
      totalLatencyMs: 0,
      maxLatencyMs: 0,
      resolved: 0,
    };
    this.mismatchLog = [];
    for (let i = 0; i < poolSize; i++) this.pool.push(this.#createBuffer());
  }

  #createBuffer() {
    const buffer = this.device.createBuffer({
      size: PICK_BUFFER_SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.stats.poolCreated++;
    return { buffer, busy: false };
  }

  get inFlight() {
    return this.pool.filter((e) => e.busy).length;
  }

  #acquire() {
    const free = this.pool.find((e) => !e.busy);
    if (!free) return null;
    free.busy = true;
    this.stats.poolReused++;
    return free;
  }

  // 在帧编码阶段调用：把 ID 纹理中的目标像素拷入暂存缓冲
  // request = { px, py, version, submitTime, cpu }
  encodePick(encoder, idTexture, request) {
    const entry = this.#acquire();
    if (!entry) {
      this.stats.droppedNoBuffer++;
      return null;
    }
    encoder.copyTextureToBuffer(
      { texture: idTexture, origin: { x: request.px, y: request.py } },
      { buffer: entry.buffer, bytesPerRow: PICK_BUFFER_SIZE, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 }
    );
    this.stats.submitted++;
    return entry;
  }

  // 提交后调用：发起异步映射，解析时做版本与存活校验
  resolve(entry, request, scene, onHit) {
    entry.buffer.mapAsync(GPUMapMode.READ).then(() => {
      const latency = performance.now() - request.submitTime;
      const data = new Uint32Array(entry.buffer.getMappedRange().slice(0, 8));
      entry.buffer.unmap();
      entry.busy = false;

      this.stats.resolved++;
      this.stats.lastLatencyMs = latency;
      this.stats.totalLatencyMs += latency;
      this.stats.maxLatencyMs = Math.max(this.stats.maxLatencyMs, latency);

      if (request.version !== scene.version) {
        this.stats.discarded++;
        return;
      }
      const objectId = data[0] === 0 ? 0 : data[0] - 1;
      const instanceId = data[1] === 0 ? 0 : data[1] - 1;
      let hit = null;
      if (data[0] !== 0) {
        const obj = scene.getObject(objectId);
        if (!obj || instanceId >= obj.instances.length) {
          this.stats.discarded++;
          return;
        }
        hit = { objectId, instanceId };
      }

      const gpuKey = hit ? `${hit.objectId}:${hit.instanceId}` : 'bg';
      const cpuKey = request.cpu ? `${request.cpu.objectId}:${request.cpu.instanceId}` : 'bg';
      if (gpuKey !== cpuKey) {
        this.stats.mismatches++;
        if (this.mismatchLog.length < 20) {
          this.mismatchLog.push({ px: request.px, py: request.py, gpu: gpuKey, cpu: cpuKey });
        }
      }

      if (hit) this.stats.validHits++;
      else this.stats.backgroundHits++;
      onHit(hit, latency);
    }).catch((err) => {
      entry.busy = false;
      (window.__PICK_ERRORS__ = window.__PICK_ERRORS__ || []).push(String(err && err.message || err));
    });
  }
}
