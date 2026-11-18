'use strict';

class HUD {
  constructor() {
    this.el = {
      speed: document.getElementById('p-speed'),
      distortion: document.getElementById('p-distortion'),
      wavelength: document.getElementById('p-wavelength'),
      mix: document.getElementById('p-mix'),
      rtSize: document.getElementById('rt-size'),
      resolution: document.getElementById('m-resolution'),
      scale: document.getElementById('m-scale'),
      drawtime: document.getElementById('m-drawtime'),
      tris: document.getElementById('m-tris'),
      draws: document.getElementById('m-draws'),
      clip: document.getElementById('m-clip'),
      clipSub: document.getElementById('m-clip-sub'),
      frame: document.getElementById('m-frame'),
      fps: document.getElementById('m-fps'),
      pickUV: document.getElementById('pick-uv'),
      pickWorld: document.getElementById('pick-world'),
      pickState: document.getElementById('pick-state'),
      pickTag: document.getElementById('pick-state-tag'),
      ring: document.querySelector('.ring'),
      gpu: document.getElementById('gpu-label'),
      pause: document.getElementById('btn-pause'),
      inspect: document.getElementById('btn-inspect'),
      crosshair: document.getElementById('crosshair')
    };
    this.regime = 'current';
    this.onRegimeChange = null;
    this.onTogglePause = null;
    this.paused = false;
    this.inspect = false;

    document.querySelectorAll('.regime').forEach((btn) => {
      btn.addEventListener('click', () => this.setRegime(btn.dataset.regime));
    });
    this.el.pause.addEventListener('click', () => this.togglePause());
    this.el.inspect.addEventListener('click', () => this.toggleInspect());
    window.addEventListener('keydown', (e) => {
      if (e.key === '1') this.setRegime('current');
      if (e.key === '2') this.setRegime('calm');
      if (e.key === ' ') { e.preventDefault(); this.togglePause(); }
      if (e.key === 'i' || e.key === 'I') this.toggleInspect();
    });
  }

  setRegime(name) {
    if (!REGIMES[name]) return;
    this.regime = name;
    document.querySelectorAll('.regime').forEach((b) =>
      b.classList.toggle('active', b.dataset.regime === name));
    if (this.onRegimeChange) this.onRegimeChange(name);
  }

  togglePause() {
    this.paused = !this.paused;
    this.el.pause.classList.toggle('active', this.paused);
    this.el.pause.innerHTML = this.paused
      ? '<span class="ic">▶</span> PLAY'
      : '<span class="ic">❚❚</span> PAUSE';
    if (this.onTogglePause) this.onTogglePause(this.paused);
  }

  toggleInspect() {
    this.inspect = !this.inspect;
    this.el.inspect.classList.toggle('active', this.inspect);
    this.el.crosshair.style.opacity = this.inspect ? '1' : '';
  }

  setParams(r) {
    this.el.speed.textContent = r.speed.toFixed(2);
    this.el.distortion.textContent = r.distortion.toFixed(3);
    this.el.wavelength.textContent = r.wavelength.toFixed(2);
    this.el.mix.textContent = r.mix.toFixed(2);
  }

  updatePick(pick) {
    if (pick.hit) {
      this.el.pickUV.textContent =
        `${pick.uv[0].toFixed(3)} / ${pick.uv[1].toFixed(3)}`;
      this.el.pickWorld.textContent =
        `${pick.world[0].toFixed(1)} / ${pick.world[1].toFixed(1)} / ${pick.world[2].toFixed(1)}`;
      this.el.pickState.textContent = 'SURFACE HIT · MIRROR SAMPLE';
      this.el.pickTag.textContent = 'SAMPLING';
      this.el.ring.classList.add('hit');
    } else {
      this.el.pickState.textContent = 'NO WATER HIT';
      this.el.pickTag.textContent = 'MISSED';
      this.el.ring.classList.remove('hit');
    }
  }

  updateStats(stats) {
    this.el.rtSize.textContent = `${stats.rtW}×${stats.rtH}`;
    this.el.resolution.textContent = `${stats.rtW} × ${stats.rtH}`;
    const ar = (this.el.resolution.ownerDocument.defaultView.innerWidth /
      this.el.resolution.ownerDocument.defaultView.innerHeight).toFixed(2);
    this.el.scale.textContent = `0.72 · 0.72 · ${ar}:1`;
    this.el.drawtime.textContent = stats.mirrorMs.toFixed(2);
    this.el.tris.textContent = (stats.tris / 1000).toFixed(1);
    this.el.draws.textContent = `${stats.draws} DRAWS · SCENE+`;
    this.el.clip.textContent = stats.leak === 0 ? 'CLEAN' : 'LEAK';
    this.el.clip.classList.toggle('ok', stats.leak === 0);
    this.el.clipSub.textContent = stats.leak === 0
      ? '● NO UNDERWATER LEAK'
      : `● ${stats.leak} LEAKED FRAGS`;
    this.el.frame.textContent = String(stats.frame).padStart(4, '0');
    this.el.fps.textContent = stats.fps || '—';
  }

  setGpu(label) {
    const tag = /swiftshader|software/i.test(label) ? 'SWIFTSHADER' : label.slice(0, 14).toUpperCase();
    this.el.gpu.textContent = `${tag} · WEBGL 2`;
  }
}

window.HUD = HUD;
