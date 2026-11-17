import { Renderer } from './renderer.js';
import { makeCamera } from './scene.js';

const canvas = document.getElementById('gl');
canvas.width = 640;
canvas.height = 480;

const renderer = new Renderer(canvas);
const camera = makeCamera(canvas.width, canvas.height);

let mode = 'deferred';
let debugChannel = 1;
let sortTransparent = true;

const modeButtons = document.querySelectorAll('[data-mode]');
const debugRow = document.getElementById('debug-row');

for (const btn of modeButtons) {
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    modeButtons.forEach((b) => b.classList.toggle('active', b === btn));
    debugRow.hidden = mode !== 'debug';
    draw();
  });
}
for (const btn of document.querySelectorAll('[data-debug]')) {
  btn.addEventListener('click', () => {
    debugChannel = Number(btn.dataset.debug);
    document.querySelectorAll('[data-debug]')
      .forEach((b) => b.classList.toggle('active', b === btn));
    draw();
  });
}
document.getElementById('sort-toggle').addEventListener('change', (e) => {
  sortTransparent = e.target.checked;
  draw();
});

function draw() {
  if (mode === 'forward') {
    renderer.renderForward(camera, sortTransparent);
    renderer.blitToScreen(renderer.fwdColor);
  } else if (mode === 'deferred') {
    renderer.render(camera, 'deferred', sortTransparent);
    renderer.blitToScreen(renderer.sceneColor);
  } else {
    renderer.render(camera, 'debug', sortTransparent);
    renderer.renderDebug(debugChannel);
  }
}

// Harness hooks for the headless regression tests.
window.__app = {
  draw,
  setMode(m) { mode = m; draw(); },
  setDebugChannel(c) { debugChannel = c; draw(); },
  setSort(v) { sortTransparent = !!v; draw(); },
  readPixels(target) {
    const gl = renderer.gl;
    const map = {
      scene: [renderer.sceneFB, gl.COLOR_ATTACHMENT0, true],
      forward: [renderer.forwardFB, gl.COLOR_ATTACHMENT0, true],
      pos: [renderer.gBuffer, gl.COLOR_ATTACHMENT0, true],
      normal: [renderer.gBuffer, gl.COLOR_ATTACHMENT1],
      albedo: [renderer.gBuffer, gl.COLOR_ATTACHMENT2],
    };
    const [fb, attachment, isFloat] = map[target];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.readBuffer(attachment);
    const count = canvas.width * canvas.height * 4;
    let px;
    if (isFloat) {
      const raw = new Float32Array(count);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA,
        gl.FLOAT, raw);
      px = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        px[i] = Math.max(0, Math.min(255, Math.round(raw[i] * 255)));
      }
    } else {
      px = new Uint8Array(count);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA,
        gl.UNSIGNED_BYTE, px);
    }
    return { width: canvas.width, height: canvas.height, pixels: px };
  },
  screenshot() {
    const gl = renderer.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const px = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA,
      gl.UNSIGNED_BYTE, px);
    return { width: canvas.width, height: canvas.height, pixels: px };
  },
};

draw();
