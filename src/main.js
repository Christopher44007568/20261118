import { mat4, vec3 } from './math.js';
import { buildScene } from './scene.js';
import { Renderer } from './renderer.js';

const SHADER_FILES = {
  fullscreenVert: 'src/shaders/fullscreen.vert',
  gbufferVert: 'src/shaders/gbuffer.vert',
  gbufferFrag: 'src/shaders/gbuffer.frag',
  normalFrag: 'src/shaders/reconstruct-normal.frag',
  ssaoFrag: 'src/shaders/ssao.frag',
  blurFrag: 'src/shaders/blur.frag',
  compositeFrag: 'src/shaders/composite.frag'
};

async function loadShaders() {
  const out = {};
  for (const [key, file] of Object.entries(SHADER_FILES)) {
    out[key] = await fetch(file).then((r) => r.text());
  }
  return out;
}

class DemoApp {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = 960;
    this.height = 720;
    this.yaw = 0.35;
    this.pitch = 0.42;
    this.distance = 9.5;
    this.target = [0, 1.0, -0.6];
  }

  async init() {
    const sources = await loadShaders();
    this.renderer = new Renderer(this.canvas, sources);
    const { objects, probes } = buildScene();
    this.sceneObjects = objects;
    this.probes = probes;
    this.renderer.uploadMeshes(objects);
    this.renderer.resize(this.width, this.height);
    this._updateCamera();
    this.renderer.frame();
    this._bindUi();
    return this;
  }

  _updateCamera() {
    const cp = Math.cos(this.pitch);
    const eye = [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw)
    ];
    this.eye = eye;
    this.proj = mat4.perspective((50 * Math.PI) / 180, this.width / this.height, 0.1, 60);
    this.view = mat4.lookAt(eye, this.target, [0, 1, 0]);
    this.renderer.setCamera(this.view, this.proj);
  }

  setParams(patch) {
    Object.assign(this.renderer.params, patch);
  }

  setCameraAngles(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = pitch;
    this._updateCamera();
  }

  renderFrame() {
    this._updateCamera();
    const t0 = performance.now();
    this.renderer.frame();
    const t1 = performance.now();
    return { cpuMs: t1 - t0 };
  }

  // Project a world-space anchor to canvas pixels (y-up like readPixels).
  project(worldPoint) {
    const view = vec3.transformPoint(this.view, worldPoint);
    const clip = vec3.transformPoint(this.proj, view);
    return {
      x: (clip[0] * 0.5 + 0.5) * this.width,
      y: (clip[1] * 0.5 + 0.5) * this.height,
      ndcZ: clip[2],
      viewDepth: -view[2]
    };
  }

  _bindUi() {
    const bind = (id, key, parse = parseFloat) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        this.setParams({ [key]: parse(el.value) });
        const out = document.getElementById(id + 'Value');
        if (out) out.textContent = el.value;
        this.renderFrame();
      });
    };
    bind('radius', 'radius');
    bind('bias', 'depthBias');
    bind('intensity', 'intensity');
    bind('samples', 'kernelSize', (v) => parseInt(v, 10));
    const viewSel = document.getElementById('viewMode');
    if (viewSel) {
      viewSel.addEventListener('change', () => {
        this.setParams({ viewMode: parseInt(viewSel.value, 10) });
        this.renderFrame();
      });
    }
    const blur = document.getElementById('blur');
    if (blur) {
      blur.addEventListener('change', () => {
        this.setParams({ blur: blur.checked });
        this.renderFrame();
      });
    }
  }
}

async function boot() {
  const canvas = document.getElementById('gl');
  const app = await new DemoApp(canvas).init();
  window.__ssao = app;
  window.__ssaoReady = true;
  document.dispatchEvent(new Event('ssao-ready'));
}

boot().catch((err) => {
  window.__ssaoError = String(err && err.stack || err);
  console.error(err);
});
