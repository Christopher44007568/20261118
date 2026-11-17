// CPU 侧分段计时（performance.now），用指数滑动平均稳定显示。
export class CpuTimer {
  constructor(alpha = 0.12) {
    this.alpha = alpha;
    this.avg = {};
    this.marks = {};
  }

  mark(name) {
    this.marks[name] = performance.now();
  }

  since(name) {
    const dt = performance.now() - this.marks[name];
    if (this.avg[name] === undefined) this.avg[name] = dt;
    else this.avg[name] = this.avg[name] * (1 - this.alpha) + dt * this.alpha;
    return this.avg[name];
  }
}

// GPU 整帧计时：环形缓冲的 disjoint timer query，避免 CPU 端阻塞。
export class GpuTimer {
  constructor(gl, poolSize = 4) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.available = !!this.ext;
    this.pool = [];
    this.index = 0;
    this.avgMs = null;
    if (!this.available) return;
    for (let i = 0; i < poolSize; i++) {
      this.pool.push({
        query: gl.createQuery(),
        busy: false,
      });
    }
  }

  begin() {
    if (!this.available) return;
    const gl = this._gl();
    const slot = this.pool[this.index];
    if (slot.busy) return;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, slot.query);
    slot.busy = true;
    this.active = slot;
    this.index = (this.index + 1) % this.pool.length;
  }

  end() {
    if (!this.available || !this.active) return;
    const gl = this._gl();
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.active = null;
  }

  poll() {
    if (!this.available) return null;
    const gl = this._gl();
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    for (const slot of this.pool) {
      if (!slot.busy) continue;
      const ready = gl.getQueryParameter(slot.query, gl.QUERY_RESULT_AVAILABLE);
      if (ready && !disjoint) {
        const nanos = gl.getQueryParameter(slot.query, gl.QUERY_RESULT);
        const ms = nanos / 1e6;
        this.avgMs = this.avgMs === null ? ms : this.avgMs * 0.88 + ms * 0.12;
        slot.busy = false;
      } else if (ready) {
        slot.busy = false;
      }
    }
    return this.avgMs;
  }

  _gl() {
    return this.gl;
  }
}

// 按格式估算离屏渲染资源占用（字节）。
// RGBA8 = 4B/像素/采样；DEPTH_COMPONENT24 ≈ 3B/像素/采样；普通纹理 4B/像素。
export function estimateMemory(width, height, samples) {
    const pixels = width * height;
    const colorTexBytes = pixels * 4;
    let msColor = 0;
    let msDepth = 0;
    if (samples > 1) {
      msColor = pixels * 4 * samples;
      msDepth = pixels * 3 * samples;
    } else {
      msDepth = pixels * 3;
    }
    const total = msColor + msDepth + colorTexBytes;
    return {
      width, height, samples, pixels,
      msColorBytes: msColor,
      msDepthBytes: msDepth,
      colorTextureBytes: colorTexBytes,
      totalBytes: total,
    };
}

export function formatMiB(bytes) {
  return (bytes / 1048576).toFixed(2) + ' MiB';
}

export function formatMs(value) {
  if (value === null || value === undefined) return '–';
  return value.toFixed(2) + ' ms';
}
