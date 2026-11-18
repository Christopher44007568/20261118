// App wiring: camera, UI, main loop, and the __sim test/debug API.

function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

class OrbitCamera {
  constructor() {
    this.theta = 0.6;
    this.phi = 1.15;
    this.radius = 12;
    this.target = [0, 0.6, 0];
    this.fovY = 55 * Math.PI / 180;
    this.eye = [0, 0, 12];
    this.proj = null;
    this.view = null;
  }
  update(aspect) {
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    this.eye = [
      this.target[0] + this.radius * sp * Math.sin(this.theta),
      this.target[1] + this.radius * cp,
      this.target[2] + this.radius * sp * Math.cos(this.theta),
    ];
    this.proj = mat4Perspective(this.fovY, aspect, 0.08, 240);
    this.view = mat4LookAt(this.eye, this.target, [0, 1, 0]);
  }
}

(function boot() {
  const canvas = document.getElementById('gl');
  const qs = new URLSearchParams(location.search);
  const slotCount = Math.max(1024, parseInt(qs.get('slots') || '131072', 10) | 0);

  let sim;
  try {
    sim = new ParticleSim(canvas, slotCount);
  } catch (err) {
    document.getElementById('m-active').textContent = 'WebGL2 unavailable';
    console.error(err);
    return;
  }

  const camera = new OrbitCamera();
  const el = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString('en-US');

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- UI wiring ----
  const streamBtn = el('btn-stream');
  function setEmitting(on) {
    sim.params.emitting = on;
    streamBtn.classList.toggle('off', !on);
  }
  streamBtn.addEventListener('click', () => setEmitting(!sim.params.emitting));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); setEmitting(!sim.params.emitting); }
  });
  el('s-rate').addEventListener('input', (e) => {
    sim.params.rate = +e.target.value;
    el('v-rate').textContent = fmt(sim.params.rate) + ' /s';
  });
  el('s-life').addEventListener('input', (e) => {
    sim.params.lifetime = +e.target.value;
    el('v-life').textContent = sim.params.lifetime.toFixed(1) + ' s';
  });
  el('s-turb').addEventListener('input', (e) => {
    sim.params.turbulence = +e.target.value;
    el('v-turb').textContent = sim.params.turbulence.toFixed(2);
  });
  el('btn-burst').addEventListener('click', () => sim.burst(3000));
  const driftBtn = el('btn-drift');
  driftBtn.classList.add('active');
  driftBtn.addEventListener('click', () => {
    sim.params.drift = !sim.params.drift;
    driftBtn.classList.toggle('active', sim.params.drift);
  });

  // ---- Camera input ----
  let dragging = false, px = 0, py = 0;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; px = e.clientX; py = e.clientY; });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    camera.theta -= (e.clientX - px) * 0.005;
    camera.phi = Math.min(3.0, Math.max(0.15, camera.phi - (e.clientY - py) * 0.005));
    px = e.clientX; py = e.clientY;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.radius = Math.min(60, Math.max(0.4, camera.radius * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  // ---- HUD ----
  let fpsEMA = 0, hudTick = 0;
  function updateHUD(dt, force) {
    if (dt > 0) fpsEMA = fpsEMA * 0.92 + (1 / dt) * 0.08;
    if (!force && (hudTick++ & 7) !== 0) return;
    const s = sim.stats();
    el('m-active').textContent = fmt(s.active);
    el('m-capacity').textContent = '/ ' + fmt(s.capacity) + ' slots';
    el('m-free').textContent = fmt(s.free);
    el('m-gpu').innerHTML = s.timerAvailable
      ? s.gpuMs.toFixed(2) + '<small> ms</small>'
      : 'n/a';
    el('m-fps').innerHTML = fpsEMA.toFixed(0) + '<small> fps</small>';
    el('m-buffer').textContent =
      'FIXED BUFFER ' + (s.bufferBytes / 1048576).toFixed(1) + ' MB · TF ×2 · TIMED';
    el('cam-pos').textContent =
      'X ' + camera.eye[0].toFixed(1) + ' / Y ' + camera.eye[1].toFixed(1) +
      ' / Z ' + camera.eye[2].toFixed(1);
    const st = el('status');
    st.textContent = sim.params.emitting ? '● RUNNING' : '● DRAINING';
    st.classList.toggle('paused', !sim.params.emitting);
  }

  // ---- Main loop ----
  let autoRun = true;
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (autoRun) {
      camera.update(canvas.width / canvas.height);
      sim.step(dt, camera);
      updateHUD(dt);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- Test / debug API ----
  window.__sim = {
    ready: true,
    pause() { autoRun = false; },
    resume() { autoRun = true; last = performance.now(); },
    step(dt, frames = 1) {
      for (let i = 0; i < frames; i++) {
        camera.update(canvas.width / canvas.height);
        sim.step(dt, camera);
      }
      updateHUD(dt, true);
    },
    setEmitting: (on) => setEmitting(on),
    setRate: (r) => { sim.params.rate = r; },
    setLifetime: (l) => { sim.params.lifetime = l; },
    setTurbulence: (v) => { sim.params.turbulence = v; },
    setDrift: (d) => { sim.params.drift = d; },
    burst: (n) => sim.burst(n),
    setCamera: (theta, phi, radius) => {
      camera.theta = theta; camera.phi = phi; camera.radius = radius;
    },
    stats: () => sim.stats(),
    readPositions: () => sim.readPositions(),
    glError: () => sim.gl.getError(),
  };
})();
