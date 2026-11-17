// Smoke test: run main.js with a stubbed DOM for a few hundred frames.
const gradient = { addColorStop() {} };
const ctx2d = new Proxy({}, {
  get: (t, prop) => {
    if (prop === 'createLinearGradient') return () => gradient;
    return () => {};
  },
  set: () => true,
});
function makeCanvas() {
  return {
    width: 0, height: 0,
    getContext: () => ctx2d,
    addEventListener() {},
  };
}
const view = makeCanvas();
const hud = { textContent: '' };

globalThis.document = {
  getElementById: id => (id === 'view' ? view : hud),
  createElement: () => makeCanvas(),
};
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;

let rafCb = null;
globalThis.requestAnimationFrame = cb => { rafCb = cb; };

await import('../main.js');

for (let i = 0; i < 600; i++) {
  const cb = rafCb;
  rafCb = null;
  cb();
}
if (!hud.textContent.includes('命中率')) throw new Error('HUD not updated');
console.log('SMOKE OK');
console.log(hud.textContent);
