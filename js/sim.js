// ParticleSim — GPU-resident particle pool driven by WebGL2 transform feedback.
//
// CPU responsibilities: initialization, camera uniforms, emission parameters,
// and a lightweight slot-recycling schedule (slot indices + death times only —
// no particle state ever lives on or returns to the CPU).
// GPU responsibilities: all motion integration, aging, spawning, and rendering.

const MAX_SPAWNS_PER_FRAME = 4096;

class ParticleSim {
  constructor(canvas, slotCount) {
    this.canvas = canvas;
    this.N = slotCount;
    const gl = this.gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available');

    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.timerPool = [];
    this.timerPending = [];
    this.gpuMs = 0;

    // Simulation time (seconds). Deterministic when driven via step().
    this.time = 0;

    // Emission parameters (CPU-side knobs).
    this.params = {
      emitting: true,
      rate: 2400,          // particles / second
      lifetime: 4.2,       // base lifetime, jittered per spawn
      turbulence: 0.72,
      speed: 2.3,
      spread: 0.95,
      drag: 0.32,
      gravity: [0, 0.16, 0],
      drift: true,
      size: 0.055,
    };

    // --- Recycling queue bookkeeping (slot lifecycle only) ---
    // slotState[i]: 0 = free, 1 = alive. deathHeap: [simTime, slot] pairs.
    this.slotState = new Uint8Array(this.N);
    this.deathHeap = [];
    this.cursor = 0;
    this.activeCount = 0;
    this.recycledTotal = 0;   // cumulative slots reclaimed after death
    this.emitAccumulator = 0;

    this.spawnData = new Float32Array(MAX_SPAWNS_PER_FRAME * 4);
    this.spawnCount = 0;
    this.spawnStart = 0;

    this._buildPrograms();
    this._buildBuffers();
    this._buildSpawnTexture();
  }

  _compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  _buildPrograms() {
    const gl = this.gl;
    // Update program (transform feedback, rasterizer discarded).
    const up = gl.createProgram();
    gl.attachShader(up, this._compile(gl.VERTEX_SHADER, UPDATE_VS));
    gl.attachShader(up, this._compile(gl.FRAGMENT_SHADER, UPDATE_FS));
    gl.transformFeedbackVaryings(up,
      ['v_posSize', 'v_velAge', 'v_color', 'v_meta'], gl.SEPARATE_ATTRIBS);
    gl.linkProgram(up);
    if (!gl.getProgramParameter(up, gl.LINK_STATUS)) {
      throw new Error('Update program link failed: ' + gl.getProgramInfoLog(up));
    }
    this.updateProg = up;
    this.u = {};
    for (const name of ['u_dt','u_time','u_emitPos','u_emitDir','u_emitSpread',
      'u_emitSpeed','u_turbulence','u_gravity','u_drag','u_spawnStart',
      'u_spawnCount','u_spawnTex','u_paletteA','u_paletteB','u_paletteC']) {
      this.u[name] = gl.getUniformLocation(up, name);
    }

    // Render program.
    const rp = gl.createProgram();
    gl.attachShader(rp, this._compile(gl.VERTEX_SHADER, RENDER_VS));
    gl.attachShader(rp, this._compile(gl.FRAGMENT_SHADER, RENDER_FS));
    gl.linkProgram(rp);
    if (!gl.getProgramParameter(rp, gl.LINK_STATUS)) {
      throw new Error('Render program link failed: ' + gl.getProgramInfoLog(rp));
    }
    this.renderProg = rp;
    this.r = {};
    for (const name of ['u_proj','u_view','u_pointScale']) {
      this.r[name] = gl.getUniformLocation(rp, name);
    }
  }

  _buildBuffers() {
    const gl = this.gl;
    const N = this.N;
    // Two ping-pong sets; each set holds 4 state buffers of N x vec4.
    this.sets = [0, 1].map(() => {
      const buffers = [];
      for (let i = 0; i < 4; i++) {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, N * 16, gl.DYNAMIC_COPY);
        // Zero-initialize: meta.z = 0 -> every slot starts dead.
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(N * 4));
        buffers.push(buf);
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      for (let loc = 0; loc < 4; loc++) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers[loc]);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);
      }
      gl.bindVertexArray(null);
      const tf = gl.createTransformFeedback();
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
      for (let i = 0; i < 4; i++) {
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, i, buffers[i]);
      }
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      return { buffers, vao, tf };
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.src = 0;
    this.bufferBytes = N * 16 * 4 * 2; // fixed for the lifetime of the app
  }

  _buildSpawnTexture() {
    const gl = this.gl;
    this.spawnTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.spawnTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, MAX_SPAWNS_PER_FRAME, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ---- Recycling queue -------------------------------------------------
  // Min-heap of [deathTime, slot] pairs, scheduled by the CPU at emission.
  _heapPush(t, slot) {
    const h = this.deathHeap;
    h.push(t, slot);
    let i = (h.length >> 1) - 1;
    while (i > 0) {
      const p = (((i + 1) >> 1) - 1) * 2;
      if (h[p] <= h[i * 2]) break;
      for (let k = 0; k < 2; k++) { const tmp = h[p + k]; h[p + k] = h[i * 2 + k]; h[i * 2 + k] = tmp; }
      i = p >> 1;
    }
  }
  _heapPop() {
    const h = this.deathHeap;
    const top = [h[0], h[1]];
    const ls = h.pop(), lt = h.pop(); // pop slot first, then time
    if (h.length) {
      h[0] = lt; h[1] = ls;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        if (r * 2 < h.length && h[r * 2] < h[i * 2] && h[r * 2] <= h[l * 2]) {
          for (let k = 0; k < 2; k++) { const tmp = h[r * 2 + k]; h[r * 2 + k] = h[i * 2 + k]; h[i * 2 + k] = tmp; }
          i = r;
        } else if (l * 2 < h.length && h[l * 2] < h[i * 2]) {
          for (let k = 0; k < 2; k++) { const tmp = h[l * 2 + k]; h[l * 2 + k] = h[i * 2 + k]; h[i * 2 + k] = tmp; }
          i = l;
        } else break;
      }
    }
    return top;
  }

  // Reclaim slots whose lifetime has expired (GPU flips state on its own;
  // this only mirrors the schedule so the cursor knows which slots are free).
  _reapDead() {
    while (this.deathHeap.length && this.deathHeap[0] <= this.time) {
      const [, slot] = this._heapPop();
      this.slotState[slot] = 0;
      this.activeCount--;
      this.recycledTotal++;
    }
  }

  // Advance the recycling cursor over free slots and queue up to `want` spawns.
  _fillSpawnWindow(want) {
    const N = this.N;
    let scanned = 0;
    while (scanned < N && this.slotState[this.cursor] === 1) {
      this.cursor = (this.cursor + 1) % N;
      scanned++;
    }
    let k = Math.min(want, MAX_SPAWNS_PER_FRAME, N - this.cursor);
    let run = 0;
    while (run < k && this.slotState[this.cursor + run] === 0) run++;
    k = run;
    this.spawnStart = this.cursor;
    this.spawnCount = k;
    if (k === 0) return;

    const d = this.spawnData;
    for (let i = 0; i < k; i++) {
      const slot = this.cursor + i;
      const life = this.params.lifetime * (0.55 + 0.9 * Math.random());
      d[i * 4 + 0] = life;
      d[i * 4 + 1] = (Math.random() * 0xffffffff) >>> 0;
      d[i * 4 + 2] = Math.random();
      d[i * 4 + 3] = this.params.size * (0.6 + 0.9 * Math.random());
      this.slotState[slot] = 1;
      this.activeCount++;
      this._heapPush(this.time + life, slot);
    }
    this.cursor = (this.cursor + k) % N;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.spawnTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, k, 1, gl.RGBA, gl.FLOAT, d.subarray(0, k * 4));
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  burst(n) {
    this.emitAccumulator += n;
  }

  // ---- GPU update pass ---------------------------------------------------
  _beginTimer() {
    const gl = this.gl;
    if (!this.timerExt) return null;
    if (this.timerPending.length > 4) return null; // don't pile up queries
    const q = this.timerPool.pop() || gl.createQuery();
    gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, q);
    return q;
  }
  _endTimer(q) {
    const gl = this.gl;
    if (!q) return;
    gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
    this.timerPending.push(q);
  }
  _pollTimers() {
    const gl = this.gl;
    if (!this.timerExt) return;
    while (this.timerPending.length) {
      const q = this.timerPending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(this.timerExt.GPU_DISJOINT_EXT)) {
        this.gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      }
      this.timerPending.shift();
      this.timerPool.push(q);
    }
  }

  // Advance the whole simulation by dt seconds (update + render).
  step(dt, camera) {
    const gl = this.gl;
    dt = Math.min(dt, 0.1); // clamp huge tab-switch deltas
    this.time += dt;

    this._reapDead();
    if (this.params.emitting) this.emitAccumulator += this.params.rate * dt;
    const want = Math.floor(this.emitAccumulator);
    if (want > 0) {
      this.emitAccumulator -= want;
      this._fillSpawnWindow(want);
    } else {
      this.spawnCount = 0;
    }

    const p = this.params;
    const t = this.time;
    const emitPos = p.drift
      ? [Math.sin(t * 0.31) * 1.6, Math.sin(t * 0.23) * 0.9, Math.cos(t * 0.27) * 1.6]
      : [0, 0, 0];

    const src = this.sets[this.src];
    const dst = this.sets[this.src ^ 1];

    const q = this._beginTimer();
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.useProgram(this.updateProg);
    gl.uniform1f(this.u.u_dt, dt);
    gl.uniform1f(this.u.u_time, t);
    gl.uniform3fv(this.u.u_emitPos, emitPos);
    gl.uniform3fv(this.u.u_emitDir, [0, 1, 0]);
    gl.uniform1f(this.u.u_emitSpread, p.spread);
    gl.uniform1f(this.u.u_emitSpeed, p.speed);
    gl.uniform1f(this.u.u_turbulence, p.turbulence);
    gl.uniform3fv(this.u.u_gravity, p.gravity);
    gl.uniform1f(this.u.u_drag, p.drag);
    gl.uniform1i(this.u.u_spawnStart, this.spawnStart);
    gl.uniform1i(this.u.u_spawnCount, this.spawnCount);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.spawnTex);
    gl.uniform1i(this.u.u_spawnTex, 0);
    gl.uniform3fv(this.u.u_paletteA, [0.25, 0.95, 0.85]);
    gl.uniform3fv(this.u.u_paletteB, [0.45, 0.45, 1.00]);
    gl.uniform3fv(this.u.u_paletteC, [1.00, 0.35, 0.75]);
    gl.bindVertexArray(src.vao);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, dst.tf);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.N);
    gl.endTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
    gl.disable(gl.RASTERIZER_DISCARD);
    this._endTimer(q);

    this.src ^= 1;
    this._render(dst.vao, camera);
    this._pollTimers();
  }

  _render(vao, camera) {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.016, 0.027, 0.047, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.renderProg);
    gl.uniformMatrix4fv(this.r.u_proj, false, camera.proj);
    gl.uniformMatrix4fv(this.r.u_view, false, camera.view);
    gl.uniform1f(this.r.u_pointScale, camera.proj[5] * h * 0.5);

    // Order-independent additive blending: no translucent sorting required.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.POINTS, 0, this.N);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  stats() {
    return {
      time: this.time,
      active: this.activeCount,
      free: this.N - this.activeCount,
      recycledTotal: this.recycledTotal,
      capacity: this.N,
      bufferBytes: this.bufferBytes,
      gpuMs: this.gpuMs,
      timerAvailable: !!this.timerExt,
      heapSize: this.deathHeap.length >> 1,
    };
  }

  // Debug/test hook: one-off readback of positions (never used per-frame).
  readPositions() {
    const gl = this.gl;
    const set = this.sets[this.src];
    const pos = new Float32Array(this.N * 4);
    const meta = new Float32Array(this.N * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, set.buffers[0]);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, set.buffers[3]);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, meta);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const out = [];
    for (let i = 0; i < this.N; i++) {
      if (meta[i * 4 + 2] > 0.5) out.push(pos[i * 4], pos[i * 4 + 1], pos[i * 4 + 2]);
    }
    return new Float32Array(out);
  }
}
